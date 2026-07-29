const express = require('express');
const { z } = require('zod');
const { getDb, admin } = require('../firebase'); // Ensure admin is exported from your firebase config
const FIREBASE_API_KEY = process.env.FIREBASE_API_KEY;

const router = express.Router();
const db = getDb();

// --- Zod Schemas ---
const authSchema = z.object({
  email: z.string().email(),
  password: z.string().min(6),
  role: z.enum(['investor', 'builder', 'serviceProvider']) // Strict role validation enforced
});

const registrationSchema = z.object({
  email: z.string().email(),
  password: z.string().min(6),
  role: z.enum(['investor', 'builder', 'serviceProvider']),
  otp: z.string().length(6, "OTP must be exactly 6 characters")
});

const parseCookies = (cookieHeader) => {
  const list = {};
  if (!cookieHeader) return list;
  cookieHeader.split(';').forEach((cookie) => {
    const parts = cookie.split('=');
    list[parts.shift().trim()] = decodeURI(parts.join('='));
  });
  return list;
};

const setAuthCookies = (res, token, refreshToken) => {
  const isProd = process.env.NODE_ENV === 'production';
  const cookieOptions = {
    httpOnly: true,
    secure: isProd,
    sameSite: 'lax',
    path: '/',
  };
  
  if (token) {
    res.cookie('user_session_token', token, {
      ...cookieOptions,
      maxAge: 3600 * 1000, // 1 hour
    });
  }
  if (refreshToken) {
    res.cookie('user_refresh_token', refreshToken, {
      ...cookieOptions,
      maxAge: 30 * 24 * 60 * 60 * 1000, // 30 days
    });
  }
};

const authenticate = async (req, res, next) => {
  const cookies = parseCookies(req.headers.cookie);
  const token = req.headers.authorization?.split('Bearer ')[1] || cookies.user_session_token;
  if (!token) return res.status(401).json({ message: 'Unauthorized' });

  // Development / Mock token bypass — NEVER active in production
  if (process.env.NODE_ENV !== 'production' && (token === 'mock_investor_token' || token === 'mock_admin_token' || token.startsWith('mock_'))) {
    const isMockAdmin = token === 'mock_admin_token' || token.includes('admin');
    const mockUid = token;
    const mockUser = {
      uid: mockUid,
      email: isMockAdmin ? 'admin@example.com' : 'investor@example.com',
      name: isMockAdmin ? 'Mock Admin' : 'Mock Investor',
      role: isMockAdmin ? 'admin' : 'investor'
    };

    try {
      const userRef = db.collection('users').doc(mockUid);
      const doc = await userRef.get();
      if (!doc.exists) {
        await userRef.set({
          uid: mockUid,
          email: mockUser.email,
          fullName: mockUser.name,
          role: mockUser.role,
          createdAt: new Date().toISOString(),
          onboardingStatus: 'complete',
          isVerified: true
        });
      }
    } catch (dbErr) {
      console.error('[Mock Auth] Failed to seed mock user in DB:', dbErr);
    }

    req.user = mockUser;
    return next();
  }

  try {
    const decodedToken = await admin.auth().verifyIdToken(token);
    req.user = decodedToken;

    // Enrich req.user with role from Firestore (role is not stored in JWT claims)
    if (!req.user.role) {
      try {
        const userDoc = await db.collection('users').doc(decodedToken.uid).get();
        if (userDoc.exists) {
          req.user.role = userDoc.data().role;
        }
      } catch (dbErr) {
        // Non-fatal: role enrichment failed, queries will fall back to UID-only
        console.warn('[Auth] Failed to enrich user role from Firestore:', dbErr.message);
      }
    }

    next();
  } catch (error) {
    res.status(401).json({ message: 'Invalid token' });
  }
};

// --- Send OTP for Registration Verification ---
router.post('/send-otp', async (req, res) => {
  try {
    const { email } = req.body;
    if (!email) {
      return res.status(400).json({ message: 'Email address is required.' });
    }

    // Check if account already exists to prevent duplicate signups
    try {
      await admin.auth().getUserByEmail(email);
      return res.status(400).json({ message: 'The email address is already in use by another account.' });
    } catch (authErr) {
      // User does not exist, proceed with sending OTP
    }

    // Generate 6-digit OTP
    const otp = Math.floor(100000 + Math.random() * 900000).toString();
    const expiresAt = new Date(Date.now() + 10 * 60 * 1000).toISOString(); // 10 minutes from now

    // Save to Firestore
    await db.collection('otps').doc(email.toLowerCase()).set({
      otp,
      expiresAt,
      createdAt: new Date().toISOString()
    });

    // Send OTP via Email
    try {
      const { sendMail, buildTemplate } = require('../utils/emailHelper');
      const html = buildTemplate(
        'Email Verification OTP',
        `
          <p>Thank you for initiating registration with <strong>Investate India</strong>.</p>
          <p>Please use the following 6-digit verification code to complete your registration:</p>
          <div style="font-size: 26px; font-weight: 800; color: #0b264f; letter-spacing: 4px; padding: 14px; border-radius: 8px; background-color: #f1f5f9; text-align: center; margin: 20px 0; border: 1px solid #e2e8f0; font-family: monospace;">
            ${otp}
          </div>
          <p>This code is valid for <strong>10 minutes</strong>. If you did not request this code, please ignore this email.</p>
        `
      );
      await sendMail(email, 'Verify Your Email Address - Investate India', `Your verification code is: ${otp}`, html);
    } catch (emailErr) {
      console.error('[Auth Route] Failed to send verification OTP email:', emailErr.message);
    }

    res.status(200).json({ success: true, message: 'Verification OTP code sent to your email.' });
  } catch (err) {
    console.error('Send OTP Error:', err);
    res.status(500).json({ message: 'Failed to send verification OTP.', error: err.message });
  }
});

// --- Unified Registration Step 1 ---
router.post('/register-step1', async (req, res) => {
  try {
    const parsed = registrationSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ message: 'Invalid credentials or missing fields', errors: parsed.error.flatten() });
    }

    const { email, password, role, otp } = parsed.data;

    // 1. Verify OTP
    const otpDocRef = db.collection('otps').doc(email.toLowerCase());
    const otpDoc = await otpDocRef.get();
    if (!otpDoc.exists) {
      return res.status(400).json({ message: 'Verification code not found. Please request a new code.' });
    }

    const otpData = otpDoc.data();
    const now = new Date().toISOString();
    if (otpData.expiresAt < now) {
      return res.status(400).json({ message: 'Verification code has expired. Please request a new one.' });
    }

    if (otpData.otp !== otp) {
      return res.status(400).json({ message: 'Incorrect verification code. Please try again.' });
    }

    // OTP is valid! Delete it so it cannot be reused
    await otpDocRef.delete();

    // 2. Create Firebase Auth user
    const userRecord = await admin.auth().createUser({
      email,
      password,
      emailVerified: true, // Email is verified via OTP!
    });

    const newUserDoc = {
      uid: userRecord.uid,
      email: email,
      role: role,
      createdAt: new Date().toISOString(),
      onboardingStatus: 'step1_complete'
    };

    if (role === 'builder') {
      newUserDoc.isVerified = false;
    }

    await db.collection('users').doc(userRecord.uid).set(newUserDoc);

    // Assign automatic launch coupon to new users based on launch settings
    try {
      if (['investor', 'builder', 'serviceProvider'].includes(role)) {
        const countSnapshot = await db.collection('users')
          .where('role', 'in', ['investor', 'builder', 'serviceProvider'])
          .count()
          .get();

        const userCount = countSnapshot.data().count;
        const { isCouponAssignmentActive } = require('../utils/premiumCheck');

        // Check if coupon assignment rules are active
        if (isCouponAssignmentActive(userCount)) {
          const couponRef = db.collection('coupons').doc();
          await couponRef.set({
            code: `LAUNCH20-${userRecord.uid.substring(0, 6).toUpperCase()}`,
            discountAmount: 20, // $20
            type: 'launch',
            assignedTo: userRecord.uid,
            isUsed: false,
            maxUses: 1,
            usedCount: 0,
            validUntil: null,
            createdAt: new Date().toISOString(),
            status: 'active'
          });
        }
      }
    } catch (couponErr) {
      console.error("Failed to assign launch coupon:", couponErr);
    }

    res.status(201).json({
      uid: userRecord.uid,
      message: 'Account created and verified. Please proceed to profile details.'
    });

  } catch (err) {
    console.error("Step 1 Error:", err);
    if (err.code === 'auth/email-already-exists') {
      return res.status(400).json({ message: 'The email address is already in use by another account.', error: err.message });
    }
    if (err.code === 'auth/invalid-email') {
      return res.status(400).json({ message: 'The email address is invalid.', error: err.message });
    }
    if (err.code === 'auth/weak-password') {
      return res.status(400).json({ message: 'The password is too weak.', error: err.message });
    }
    res.status(500).json({ message: 'Internal Server Error', error: err.message });
  }
});

// --- Builder Registration: Submit Form 1 ---
router.post('/builder-form1/:uid', async (req, res, next) => {
  try {
    const { uid } = req.params;
    const form1Data = req.body;

    const userRef = db.collection('users').doc(uid);
    const doc = await userRef.get();

    if (!doc.exists) {
      return res.status(404).json({ message: "User not found." });
    }

    const userData = doc.data();

    // Security check: Only allow this if they are a builder
    if (userData.role !== 'builder') {
      return res.status(403).json({ message: "Only builders can submit this form." });
    }
    // Save Form 1 data and update status to form1_approved (no review needed)
    await userRef.set({
      ...form1Data,
      onboardingStatus: 'form1_approved',
      updatedAt: new Date().toISOString()
    }, { merge: true });

    // Notify all admins (for audit purposes, but not pending review)
    try {
      const { notifyAdmins, NOTIFICATION_TYPES } = require('../utils/notificationHelper');
      const name = form1Data.companyName || form1Data.contactName || userData.email || 'A builder';
      await notifyAdmins(
        NOTIFICATION_TYPES.STATUS_CHANGED,
        'New Builder Registered',
        `${name} has completed builder registration (Form 1).`,
        null,
        { userId: uid, role: 'builder' }
      );
    } catch (notifErr) {
      console.error('[AuthRoute] Builder Form 1 admin notification failed:', notifErr.message);
    }

    // Notify Builder
    try {
      const { notifyUser, NOTIFICATION_TYPES } = require('../utils/notificationHelper');
      await notifyUser(
        uid,
        NOTIFICATION_TYPES.STATUS_CHANGED,
        'Builder Registration Complete',
        'Thank you for registering on Investate India. Your basic registration (Form 1) has been approved! Please log in to complete your Form 2 verification.',
        null,
        {},
        ['builder']
      );
    } catch (notifErr) {
      console.error('[AuthRoute] Builder Form 1 user notification failed:', notifErr.message);
    }

    res.status(200).json({ message: 'Form 1 submitted successfully.' });

  } catch (err) {
    console.error("Builder Form 1 Error:", err);
    next(err);
  }
});

// --- Investor Registration: Submit Form 1 ---
router.post('/investor-form1/:uid', async (req, res, next) => {
  try {
    const { uid } = req.params;
    const form1Data = req.body;

    const userRef = db.collection('users').doc(uid);
    const doc = await userRef.get();

    if (!doc.exists) return res.status(404).json({ message: "User not found." });
    if (doc.data().role !== 'investor') return res.status(403).json({ message: "Only investors can submit this form." });

    // Save Form 1 data and update status to form1_approved (no admin review needed)
    await userRef.set({
      ...form1Data,
      onboardingStatus: 'form1_approved',
      updatedAt: new Date().toISOString()
    }, { merge: true });

    // Send email to end user (investor)
    try {
      const { sendMail, buildTemplate } = require('../utils/emailHelper');
      const userEmail = doc.data().email || form1Data.email;
      if (userEmail) {
        const name = form1Data.fullName || 'Investor';
        const emailSubject = 'Welcome to Investate India - Registration Complete';
        const emailText = `Hello ${name},\n\nThank you for registering on Investate India. Your basic registration (Form 1) has been received and verified. You can now access your dashboard and proceed with final verification (Form 2 / KYC) to unlock full opportunities.`;
        const emailHtml = buildTemplate(
          'Registration Successful',
          `<p>Hello <strong>${name}</strong>,</p>
           <p>Thank you for completing your basic registration on Investate India!</p>
           <p>Your Form 1 details have been successfully saved and approved. You now have basic dashboard access.</p>
           <p>To unlock exclusive premium property listings, blueprints, and high-yield opportunities, please complete your KYC process (Form 2) by uploading a scanned copy of your passport.</p>
           <p style="margin-top: 24px;"><a href="http://localhost:3000/investor/kyc" style="background-color: #ea580c; color: #ffffff; padding: 12px 24px; text-decoration: none; border-radius: 8px; font-weight: bold; display: inline-block;">Complete KYC Process</a></p>`
        );
        await sendMail(userEmail, emailSubject, emailText, emailHtml);
      }
    } catch (emailErr) {
      console.error('[AuthRoute] Investor Form 1 email notification failed:', emailErr.message);
    }

    // Notify admin about new investor Form 1 submission
    try {
      const { notifyAdmins, NOTIFICATION_TYPES } = require('../utils/notificationHelper');
      const name = form1Data.fullName || doc.data().email || 'An investor';
      await notifyAdmins(
        NOTIFICATION_TYPES.STATUS_CHANGED,
        'New Investor Registered',
        `${name} has completed investor registration (Form 1) and now has basic dashboard access.`,
        null,
        { userId: userRef.id, role: 'investor' }
      );
    } catch (notifErr) {
      console.error('[AuthRoute] Investor Form 1 admin notification failed:', notifErr.message);
    }

    res.status(200).json({ message: 'Form 1 submitted and approved successfully.' });

  } catch (err) {
    console.error("Investor Form 1 Error:", err);
    next(err);
  }
});

// --- Service Provider Registration: Submit Form 1 ---
router.post('/service-provider-form1/:uid', async (req, res, next) => {
  try {
    const { uid } = req.params;
    const form1Data = req.body;

    const userRef = db.collection('users').doc(uid);
    const doc = await userRef.get();

    if (!doc.exists) return res.status(404).json({ message: "User not found." });
    if (doc.data().role !== 'serviceProvider') return res.status(403).json({ message: "Only service providers can submit this form." });

    // Save Form 1 data and update status to pending admin review
    await userRef.set({
      ...form1Data,
      onboardingStatus: 'form1_pending',
      updatedAt: new Date().toISOString()
    }, { merge: true });

    // Notify all admins
    try {
      const { notifyAdmins, NOTIFICATION_TYPES } = require('../utils/notificationHelper');
      const name = form1Data.fullName || form1Data.companyName || doc.data().email || 'A service provider';
      await notifyAdmins(
        NOTIFICATION_TYPES.STATUS_CHANGED,
        'New Service Provider Registration — Needs Review',
        `${name} has submitted their service provider registration (Form 1) and is awaiting admin approval. Please review in the Manage Users section.`,
        null,
        { userId: uid, role: 'serviceProvider' }
      );
    } catch (notifErr) {
      console.error('[AuthRoute] SP Form 1 admin notification failed:', notifErr.message);
    }

    res.status(200).json({ message: 'Form 1 submitted successfully. Waiting for Admin verification.' });

  } catch (err) {
    console.error("Service Provider Form 1 Error:", err);
    next(err);
  }
});

// --- Submit Admin Requested Changes ---
router.post('/submit-changes/:uid', async (req, res, next) => {
  try {
    const { uid } = req.params;
    const updatedFields = req.body;

    const userRef = db.collection('users').doc(uid);
    const doc = await userRef.get();
    if (!doc.exists) return res.status(404).json({ message: "User not found." });

    const userData = doc.data();
    const existingChanges = userData.pendingChanges || {};

    // --- FAIL-SAFE: Check if any of the fields belong to Form 2 ---
    const form2Keys = ['profession', 'nriStatus', 'kycVisaUrl', 'yearlyIncome', 'investmentTenure', 'expectedReturns', 'preferredProjectType', 'preferredGoalStategy', 'investmentPreference', 'yearOfIncorporation', 'promotersOrDirectors', 'totalSqftDelivered', 'majorCompletedProjects', 'typeOfProjectsOffered', 'companyOverview', 'experienceWithNriInvestors', 'declaredLitigationDisputes', 'financialOfCompany', 'outstandingDebt', 'bankingPartners'];
    const isUpdatingForm2 = Object.keys(updatedFields).some(key => form2Keys.includes(key));

    // Determine the correct next status
    let newStatus = 'form1_pending';
    if (
      userData.onboardingStatus === 'form2_changes_requested' ||
      userData.onboardingStatus === 'form1_approved' ||
      userData.onboardingStatus === 'form2_pending' ||
      isUpdatingForm2 // <--- This forces it to Form 2 pending if Form 2 fields were submitted!
    ) {
      newStatus = 'form2_pending';
    }

    await userRef.update({
      pendingChanges: { ...existingChanges, ...updatedFields },
      onboardingStatus: newStatus,
      adminRequests: admin.firestore.FieldValue.delete(),
      updatedAt: new Date().toISOString()
    });

    // Notify User
    try {
      const { notifyUser, NOTIFICATION_TYPES } = require('../utils/notificationHelper');
      await notifyUser(
        uid,
        NOTIFICATION_TYPES.STATUS_CHANGED,
        'Corrections Submitted Successfully',
        'Your profile changes have been successfully submitted for review. Our team will verify them and update your account status shortly.',
        null,
        {},
        [userData.role]
      );
    } catch (notifErr) {
      console.error('[AuthRoute] Submit changes user notification failed:', notifErr.message);
    }

    res.status(200).json({ message: 'Changes submitted successfully.' });
  } catch (err) {
    next(err);
  }
});

// --- Submit Form 2 (Builder) ---
router.post('/builder-form2/:uid', async (req, res, next) => {
  try {
    const { uid } = req.params;
    const form2Data = req.body;

    const userDoc = await db.collection('users').doc(uid).get();
    await db.collection('users').doc(uid).update({
      ...form2Data,
      onboardingStatus: 'form2_pending', // Move to final review
      updatedAt: new Date().toISOString()
    });

    // Notify admins about builder form 2 submission
    try {
      const { notifyAdmins, NOTIFICATION_TYPES } = require('../utils/notificationHelper');
      const userData = userDoc.exists ? userDoc.data() : {};
      const name = userData.companyName || userData.fullName || userData.email || 'A builder';
      await notifyAdmins(
        NOTIFICATION_TYPES.STATUS_CHANGED,
        'Builder Form 2 Submitted — Final Review Needed',
        `${name} has submitted their builder profile details (Form 2) and is awaiting final approval. Please review in the Manage Users section.`,
        null,
        { userId: uid, role: 'builder' }
      );
    } catch (notifErr) {
      console.error('[AuthRoute] Builder Form 2 admin notification failed:', notifErr.message);
    }

    // Notify Builder
    try {
      const { notifyUser, NOTIFICATION_TYPES } = require('../utils/notificationHelper');
      await notifyUser(
        uid,
        NOTIFICATION_TYPES.STATUS_CHANGED,
        'Builder Verification Documents Under Review',
        'Thank you for completing your builder profile (Form 2). Our compliance team is currently reviewing your documents.',
        null,
        {},
        ['builder']
      );
    } catch (notifErr) {
      console.error('[AuthRoute] Builder Form 2 user notification failed:', notifErr.message);
    }

    res.status(200).json({ message: 'Form 2 submitted successfully.' });
  } catch (err) { next(err); }
});

// --- Submit Form 2 (Investor) ---
router.post('/investor-form2/:uid', async (req, res, next) => {
  try {
    const { uid } = req.params;
    const form2Data = req.body;

    const userDoc = await db.collection('users').doc(uid).get();
    await db.collection('users').doc(uid).update({
      ...form2Data,
      onboardingStatus: 'form2_pending', // Move to final review
      updatedAt: new Date().toISOString()
    });

    // Notify admins about investor form 2 submission
    try {
      const { notifyAdmins, NOTIFICATION_TYPES } = require('../utils/notificationHelper');
      const userData = userDoc.exists ? userDoc.data() : {};
      const name = userData.fullName || userData.email || 'An investor';
      await notifyAdmins(
        NOTIFICATION_TYPES.STATUS_CHANGED,
        'Investor Profile Details Submitted — Review Needed',
        `${name} has submitted their investor profile details (Form 2) and is awaiting final KYC approval. Please review in the Manage Users section.`,
        null,
        { userId: uid, role: 'investor' }
      );
    } catch (notifErr) {
      console.error('[AuthRoute] Investor Form 2 admin notification failed:', notifErr.message);
    }

    // Notify Investor
    try {
      const { notifyUser, NOTIFICATION_TYPES } = require('../utils/notificationHelper');
      await notifyUser(
        uid,
        NOTIFICATION_TYPES.STATUS_CHANGED,
        'Investor Profile Details Under Review',
        'Thank you for submitting your investor profile details (Form 2). Our compliance team is currently reviewing your verification details.',
        null,
        {},
        ['investor']
      );
    } catch (notifErr) {
      console.error('[AuthRoute] Investor Form 2 user notification failed:', notifErr.message);
    }

    res.status(200).json({ message: 'Form 2 submitted successfully.' });
  } catch (err) { next(err); }
});

// --- Standard Login ---
router.post('/login', async (req, res) => {
  try {
    const { email, password, role } = req.body;

    if (!email || !password || !role) {
      return res.status(400).json({ message: 'Email, password, and role are required' });
    }

    const verifyPasswordUrl = `https://identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=${FIREBASE_API_KEY}`;
    const authResponse = await fetch(verifyPasswordUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password, returnSecureToken: true })
    });

    const authData = await authResponse.json();
    if (!authResponse.ok) {
      throw new Error(authData.error?.message || 'Authentication failed');
    }

    const uid = authData.localId;

    const userDoc = await db.collection('users').doc(uid).get();

    let userData = { role: 'investor', name: email.split('@')[0], isVerified: true, onboardingStatus: 'step1_complete' };
    if (userDoc.exists) {
      userData = userDoc.data();
    }

    // CROSS-PORTAL CHECK
    if (role !== userData.role && userData.role !== 'admin') {
      let targetDisplay = 'Investor';
      if (userData.role === 'builder') targetDisplay = 'Builder';
      else if (userData.role === 'serviceProvider') targetDisplay = 'Service Provider';

      return res.status(403).json({
        message: `This account is registered as a ${targetDisplay}. Please use the ${targetDisplay} tab.`
      });
    }

    // HARD BLOCK FOR STEP 2
    if (userData.onboardingStatus === 'step1_complete') {
      return res.status(403).json({
        error: 'STEP2_PENDING',
        message: 'Profile Incomplete. Please finish your initial registration.',
        uid: uid, email: authData.email || email, name: userData.fullName
      });
    }

    // Block if Service Provider is waiting for Admin to review Form 1 or Form 2
    if (userData.role === 'serviceProvider' && (userData.onboardingStatus === 'form1_pending' || userData.onboardingStatus === 'form2_pending')) {
      return res.status(403).json({
        error: 'ACCOUNT_UNDER_REVIEW',
        message: 'Your account is currently under review by our administration team. We will notify you once verified.'
      });
    }

    // Block if Admin requested changes on Form 1
    if (userData.role === 'serviceProvider' && (userData.onboardingStatus === 'form1_changes_requested' || userData.onboardingStatus === 'form2_changes_requested')) {
      return res.status(403).json({
        error: 'CHANGES_REQUESTED',
        message: 'Admin has requested additional details.',
        uid: uid,
        role: userData.role,
        adminRequests: userData.adminRequests || [],
        userData: userData // <-- CRITICAL FIX: Sent userData so frontend has access to it
      });
    }

    // Block if Admin approved Form 1, but they haven't filled Form 2
    if (userData.role === 'serviceProvider' && userData.onboardingStatus === 'form1_approved') {
      return res.status(403).json({
        error: 'FORM2_PENDING',
        message: 'Please complete the final phase of your profile registration.',
        uid: uid,
        role: userData.role,
        userData: userData
      });
    }

    // Block if they are fully completed but an Admin manually disabled isVerified
    if ((userData.role === 'builder' || userData.role === 'serviceProvider') && userData.isVerified === false && userData.onboardingStatus === 'complete') {
      return res.status(403).json({ message: 'Your account access has been temporarily revoked. Please contact support.' });
    }

    const { getPremiumStatus } = require('../utils/premiumCheck');
    const premiumStatus = getPremiumStatus();

    setAuthCookies(res, authData.idToken, authData.refreshToken);

    res.json({
      uid: uid, email: authData.email, role: userData.role || 'investor',
      name: userData.fullName || userData.companyName || userData.email, onboardingStatus: userData.onboardingStatus,
      isPremium: premiumStatus.isPremium,
      premiumDaysLeft: premiumStatus.remainingDays,
      isKycVerified: userData.isKycVerified || false,
      kycStatus: userData.kycStatus || 'not_started',
      kycPassportUrl: userData.kycPassportUrl || null
    });

  } catch (error) {
    console.error("Login Auth Error:", error.message);
    let message = "Login failed";
    if (error.message.includes('INVALID_PASSWORD')) message = "Incorrect password.";
    if (error.message.includes('EMAIL_NOT_FOUND')) message = "No account found with this email.";
    res.status(401).json({ message, debug: error.message });
  }
});

// --- Token Refresh Endpoint ---
// Accepts a Firebase refreshToken and exchanges it for a new idToken.
// This is used by the frontend to silently renew an expired session without
// forcing the user to log in again.
router.post('/refresh-token', async (req, res) => {
  try {
    const cookies = parseCookies(req.headers.cookie);
    const refreshToken = req.body.refreshToken || cookies.user_refresh_token;
    if (!refreshToken) {
      return res.status(400).json({ message: 'refreshToken is required' });
    }

    const tokenExchangeUrl = `https://securetoken.googleapis.com/v1/token?key=${FIREBASE_API_KEY}`;
    const exchangeResponse = await fetch(tokenExchangeUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'refresh_token',
        refresh_token: refreshToken,
      }).toString(),
    });

    const exchangeData = await exchangeResponse.json();

    if (!exchangeResponse.ok) {
      const errMsg = exchangeData.error?.message || 'Token refresh failed';
      return res.status(401).json({ message: errMsg, code: exchangeData.error?.message });
    }

    setAuthCookies(res, exchangeData.id_token, exchangeData.refresh_token);

    return res.json({
      success: true,
      expiresIn: parseInt(exchangeData.expires_in, 10),
    });
  } catch (error) {
    console.error('[Refresh Token] Error:', error.message);
    res.status(500).json({ message: 'Internal server error during token refresh' });
  }
});

// --- Google Auth Sync ---
router.post('/google-sync', async (req, res) => {
  try {
    const { idToken, role } = req.body;

    if (!idToken) return res.status(400).json({ message: 'ID Token is required' });
    if (!role || !['investor', 'builder', 'serviceProvider'].includes(role)) return res.status(400).json({ message: 'Valid role is required' });

    const decodedToken = await admin.auth().verifyIdToken(idToken);
    const { uid, email, name, picture } = decodedToken;

    const userRef = db.collection('users').doc(uid);
    const doc = await userRef.get();

    let userData;

    if (!doc.exists) {
      const newUser = {
        uid, email, fullName: name || '', profileImage: picture || '',
        role: role, createdAt: new Date().toISOString(), onboardingStatus: 'step1_complete',
        ...((role === 'builder' || role === 'serviceProvider') && { isVerified: false })
      };
      await userRef.set(newUser);
      userData = newUser;

      // Assign automatic launch coupon to new users based on launch settings for Google Auth signups
      try {
        if (['investor', 'builder', 'serviceProvider'].includes(role)) {
          const countSnapshot = await db.collection('users')
            .where('role', 'in', ['investor', 'builder', 'serviceProvider'])
            .count()
            .get();

          const userCount = countSnapshot.data().count;
          const { isCouponAssignmentActive } = require('../utils/premiumCheck');

          // Check if coupon assignment rules are active
          if (isCouponAssignmentActive(userCount)) {
            const couponRef = db.collection('coupons').doc();
            await couponRef.set({
              code: `LAUNCH20-${uid.substring(0, 6).toUpperCase()}`,
              discountAmount: 20, // $20
              type: 'launch',
              assignedTo: uid,
              isUsed: false,
              maxUses: 1,
              usedCount: 0,
              validUntil: null,
              createdAt: new Date().toISOString(),
              status: 'active'
            });
          }
        }
      } catch (couponErr) {
        console.error("Failed to assign launch coupon:", couponErr);
      }
    } else {
      userData = doc.data();

      if (role !== userData.role && userData.role !== 'admin') {
        let targetDisplay = 'Investor';
        if (userData.role === 'builder') targetDisplay = 'Builder';
        else if (userData.role === 'serviceProvider') targetDisplay = 'Service Provider';

        return res.status(403).json({
          message: `This account is registered as a ${targetDisplay}. Please use the ${targetDisplay} tab.`
        });
      }
    }

    // HARD BLOCK FOR STEP 2
    if (userData.onboardingStatus === 'step1_complete') {
      return res.status(403).json({
        error: 'STEP2_PENDING',
        message: 'Profile Incomplete. Please finish your initial registration.',
        uid: uid, email: email, name: userData.fullName
      });
    }

    // Block if Service Provider is waiting for Admin to review Form 1 or Form 2
    if (userData.role === 'serviceProvider' && (userData.onboardingStatus === 'form1_pending' || userData.onboardingStatus === 'form2_pending')) {
      return res.status(403).json({
        error: 'ACCOUNT_UNDER_REVIEW',
        message: 'Your account is currently under review by our administration team. We will notify you once verified.'
      });
    }

    // Block if Admin requested changes on Form 1
    if (userData.role === 'serviceProvider' && (userData.onboardingStatus === 'form1_changes_requested' || userData.onboardingStatus === 'form2_changes_requested')) {
      return res.status(403).json({
        error: 'CHANGES_REQUESTED',
        message: 'Admin has requested additional details.',
        uid: uid,
        email: email,
        name: userData.fullName || email.split('@')[0],
        role: userData.role,
        adminRequests: userData.adminRequests || [],
        userData: userData // <-- CRITICAL FIX: Sent userData so frontend has access to it
      });
    }

    // Block if Admin approved Form 1, but they haven't filled Form 2
    if (userData.role === 'serviceProvider' && userData.onboardingStatus === 'form1_approved') {
      return res.status(403).json({
        error: 'FORM2_PENDING',
        message: 'Please complete the final phase of your profile registration.',
        uid: uid,
        email: email,
        name: userData.fullName || email.split('@')[0],
        role: userData.role,
        userData: userData
      });
    }

    // Block if they are fully completed but an Admin manually disabled isVerified
    if ((userData.role === 'builder' || userData.role === 'serviceProvider') && userData.isVerified === false && userData.onboardingStatus === 'complete') {
      return res.status(403).json({ message: 'Your account access has been temporarily revoked. Please contact support.' });
    }

    const { getPremiumStatus } = require('../utils/premiumCheck');
    const premiumStatus = getPremiumStatus();

    setAuthCookies(res, idToken, null);

    res.json({
      uid: uid, email: email, role: userData.role, name: userData.fullName || email.split('@')[0],
      onboardingStatus: userData.onboardingStatus,
      isPremium: premiumStatus.isPremium,
      premiumDaysLeft: premiumStatus.remainingDays,
      isKycVerified: userData.isKycVerified || false,
      kycStatus: userData.kycStatus || 'not_started',
      kycPassportUrl: userData.kycPassportUrl || null
    });

  } catch (error) {
    res.status(401).json({ message: 'Google Authentication failed', error: error.message });
  }
});

// --- Admin Login (Unchanged) ---
router.post('/admin-login', async (req, res) => {
  try {
    const { email, password } = req.body;

    if (!email || !password) {
      return res.status(400).json({ message: 'Email and password are required' });
    }

    const verifyPasswordUrl = `https://identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=${FIREBASE_API_KEY}`;

    const authResponse = await fetch(verifyPasswordUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password, returnSecureToken: true })
    });

    const authData = await authResponse.json();

    if (!authResponse.ok) {
      throw new Error(authData.error?.message || 'Authentication failed');
    }

    const uid = authData.localId;
    const userDoc = await db.collection('users').doc(uid).get();

    if (!userDoc.exists) {
      return res.status(403).json({ message: 'Access Denied: User record not found.' });
    }

    const userData = userDoc.data();

    if (userData.role !== 'admin') {
      return res.status(403).json({
        message: 'Access Denied: You do not have administrator privileges.'
      });
    }

    setAuthCookies(res, authData.idToken, authData.refreshToken);

    res.json({
      uid: uid,
      email: authData.email,
      role: userData.role,
      name: userData.fullName || 'Administrator'
    });

  } catch (error) {
    console.error("Admin Login Error:", error.message);
    let message = "Login failed";
    if (error.message.includes('INVALID_PASSWORD')) message = "Incorrect password";
    if (error.message.includes('EMAIL_NOT_FOUND')) message = "Email not found";
    res.status(401).json({ message });
  }
});

// --- Public Launch Config Endpoint ---
router.get('/launch-config', async (req, res) => {
  try {
    const { getPremiumStatus } = require('../utils/premiumCheck');
    const status = getPremiumStatus();
    res.json({
      success: true,
      launchDate: status.launchDate,
      freeTrialExpiryDate: status.freeTrialExpiryDate
    });
  } catch (err) {
    res.status(500).json({ success: false, message: 'Failed to retrieve launch config', error: err.message });
  }
});

// --- Get Premium Status & Config details ---
router.get('/premium-status', authenticate, async (req, res) => {
  try {
    const { getPremiumStatus } = require('../utils/premiumCheck');
    const status = getPremiumStatus();
    res.json({ success: true, ...status });
  } catch (err) {
    res.status(500).json({ success: false, message: 'Failed to retrieve premium status', error: err.message });
  }
});

// --- Get Current User Profile details ---
router.get('/me', authenticate, async (req, res, next) => {
  try {
    const userDoc = await db.collection('users').doc(req.user.uid).get();
    if (!userDoc.exists) {
      return res.status(404).json({ success: false, message: 'User not found' });
    }
    const { password, ...safe } = userDoc.data();
    res.json({ success: true, user: safe });
  } catch (err) {
    next(err);
  }
});

/**
 * PATCH /api/auth/profile
 * Updates the authenticated user's profile details
 */
router.patch('/profile', authenticate, async (req, res, next) => {
  try {
    const {
      name,
      contactNumber,
      address,
      preferredCategories,
      preferredTypes,
      preferredStages,
      preferredPurposes,
      preferredLocations,
      preferredBudgets,
      projectCategories,
      projectTypes,
      projectStages,
      capitalRequirements
    } = req.body;
    const userRef = db.collection('users').doc(req.user.uid);
    const userDoc = await userRef.get();
    if (!userDoc.exists) {
      return res.status(404).json({ success: false, message: 'User not found' });
    }

    const updates = {
      name: name !== undefined ? name : (userDoc.data().name || ''),
      fullName: name !== undefined ? name : (userDoc.data().fullName || ''),
      contactNumber: contactNumber !== undefined ? contactNumber : (userDoc.data().contactNumber || ''),
      address: address !== undefined ? address : (userDoc.data().address || ''),
      updatedAt: new Date().toISOString()
    };

    if (preferredCategories !== undefined) updates.preferredCategories = preferredCategories;
    if (preferredTypes !== undefined) updates.preferredTypes = preferredTypes;
    if (preferredStages !== undefined) updates.preferredStages = preferredStages;
    if (preferredPurposes !== undefined) updates.preferredPurposes = preferredPurposes;
    if (preferredLocations !== undefined) updates.preferredLocations = preferredLocations;
    if (preferredBudgets !== undefined) updates.preferredBudgets = preferredBudgets;

    if (projectCategories !== undefined) updates.projectCategories = projectCategories;
    if (projectTypes !== undefined) updates.projectTypes = projectTypes;
    if (projectStages !== undefined) updates.projectStages = projectStages;
    if (capitalRequirements !== undefined) updates.capitalRequirements = capitalRequirements;

    await userRef.update(updates);

    const updatedDoc = await userRef.get();
    const { password, ...safe } = updatedDoc.data();

    res.json({ success: true, message: 'Profile updated successfully', user: safe });
  } catch (err) {
    next(err);
  }
});

/**
 * GET /api/auth/membership-pricing
 * Retrieve annual membership prices for authenticated users
 */
router.get('/membership-pricing', authenticate, async (req, res, next) => {
  try {
    const doc = await db.collection('config').doc('membership_pricing').get();
    const defaults = {
      investor: 49,
      builder: 99,
      serviceProvider: 49,
      currency: 'usd'
    };
    if (!doc.exists) {
      return res.json({ success: true, data: defaults });
    }
    res.json({ success: true, data: { ...defaults, ...doc.data() } });
  } catch (err) {
    next(err);
  }
});

/**
 * POST /api/auth/logout
 * Clears secure HttpOnly authentication cookies
 */
router.post('/logout', (req, res) => {
  res.clearCookie('user_session_token', { path: '/' });
  res.clearCookie('user_refresh_token', { path: '/' });
  res.json({ success: true, message: 'Logged out successfully' });
});

module.exports = router;
module.exports.authenticate = authenticate;