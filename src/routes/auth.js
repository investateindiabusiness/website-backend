const express = require('express');
const { z } = require('zod');
const { getDb, admin } = require('../firebase'); // Ensure admin is exported from your firebase config
const FIREBASE_API_KEY = process.env.FIREBASE_API_KEY

const router = express.Router();
const db = getDb();

// --- Zod Schemas ---

const authSchema = z.object({
  email: z.string().email(),
  password: z.string().min(6),
});

const authenticate = async (req, res, next) => {
  const token = req.headers.authorization?.split('Bearer ')[1];
  if (!token) return res.status(401).json({ message: 'Unauthorized' });

  try {
    const decodedToken = await admin.auth().verifyIdToken(token);
    req.user = decodedToken;
    next();
  } catch (error) {
    res.status(401).json({ message: 'Invalid token' });
  }
};

// --- Routes ---
router.post('/register-step1', async (req, res) => {
  try {
    const parsed = authSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ message: 'Invalid credentials', errors: parsed.error.flatten() });
    }

    const { email, password } = parsed.data;

    // 1. Create user in Firebase Authentication
    const userRecord = await admin.auth().createUser({
      email,
      password,
      emailVerified: false,
    });

    await db.collection('users').doc(userRecord.uid).set({
      uid: userRecord.uid,
      email: email,
      role: 'investor',
      createdAt: new Date().toISOString(),
      onboardingStatus: 'step1_complete' // Useful flag to track incomplete registrations
    });

    res.status(201).json({ 
      uid: userRecord.uid, 
      message: 'Account created. Please proceed to profile details.' 
    });

  } catch (err) {
    console.error("Step 1 Error:", err);
    res.status(500).json({ 
      message: 'Internal Server Error', 
      error: err.message 
    });
  }
});

router.post('/register-step2/:uid', async (req, res, next) => {
  try {
    const { uid } = req.params;
    const profileData = req.body;

    // 1. Check if the user document exists first (good practice)
    const userRef = db.collection('users').doc(uid);
    const doc = await userRef.get();

    if (!doc.exists) {
      return res.status(404).json({ message: "User not found. Please complete Step 1 first." });
    }

    // 2. Update the SAME document at /users/{uid}
    // { merge: true } ensures we don't overwrite the email/role from Step 1
    await userRef.set({
      ...profileData,
      onboardingStatus: 'complete',
      updatedAt: new Date().toISOString()
    }, { merge: true });

    res.status(200).json({ message: 'Profile saved successfully' });

  } catch (err) {
    console.error("Step 2 Error:", err);
    next(err);
  }
});

router.post('/login', async (req, res) => {
  try {
    const { email, password } = req.body;

    if (!email || !password) {
      return res.status(400).json({ message: 'Email and password are required' });
    }

    // 1. Verify credentials using Google Identity Toolkit (Firebase REST API)
    // We use fetch here (native in Node 18+). If using older Node, install 'node-fetch' or 'axios'.
    const verifyPasswordUrl = `https://identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=${FIREBASE_API_KEY}`;
    
    const authResponse = await fetch(verifyPasswordUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        email,
        password,
        returnSecureToken: true
      })
    });

    const authData = await authResponse.json();

    if (!authResponse.ok) {
      // Pass the specific error from Firebase (e.g., EMAIL_NOT_FOUND, INVALID_PASSWORD)
      throw new Error(authData.error?.message || 'Authentication failed');
    }

    const uid = authData.localId;

    // 2. Fetch user role and details from your Firestore 'users' collection
    const userDoc = await db.collection('users').doc(uid).get();
    
    // Default values if user doc is missing (e.g. if created manually in console)
    let userData = { role: 'investor', name: email.split('@')[0] };
    
    if (userDoc.exists) {
      userData = userDoc.data();
    }

    // 3. Return the data your frontend expects
    res.json({
      uid: uid,
      email: authData.email,
      role: userData.role || 'investor', 
      name: userData.fullName || userData.email,
      token: authData.idToken, // The JWT token
      refreshToken: authData.refreshToken
    });

  } catch (error) {
    console.error("Login Error:", error.message);
    
    // Map Firebase errors to user-friendly messages
    let message = "Login failed";
    if (error.message.includes('INVALID_PASSWORD')) message = "Incorrect password";
    if (error.message.includes('EMAIL_NOT_FOUND')) message = "Email not found";
    
    res.status(401).json({ message });
  }
});

router.post('/builder-register-step1', async (req, res) => {
  try {
    // Reuse the same auth schema for email/password validation
    const parsed = authSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ message: 'Invalid credentials', errors: parsed.error.flatten() });
    }

    const { email, password } = parsed.data;

    // 1. Create user in Firebase Auth
    const userRecord = await admin.auth().createUser({
      email,
      password,
      emailVerified: false,
    });

    // 2. Create the ROOT document at /users/{uid}
    await db.collection('users').doc(userRecord.uid).set({
      uid: userRecord.uid,
      email: email,
      role: 'builder', // <--- IMPORTANT: Distinguishes this user as a Builder
      createdAt: new Date().toISOString(),
      onboardingStatus: 'step1_complete',
      isVerified: false // Builders usually require manual verification
    });

    res.status(201).json({ 
      uid: userRecord.uid, 
      message: 'Builder account created. Please proceed to company details.' 
    });

  } catch (err) {
    console.error("Builder Step 1 Error:", err);
    res.status(500).json({ message: 'Internal Server Error', error: err.message });
  }
});

router.post('/builder-register-step2/:uid', async (req, res, next) => {
  try {
    const { uid } = req.params;
    const profileData = req.body;

    const userRef = db.collection('users').doc(uid);
    const doc = await userRef.get();

    if (!doc.exists) {
      return res.status(404).json({ message: "User not found." });
    }

    // Update the SAME document with builder details
    await userRef.set({
      ...profileData,
      onboardingStatus: 'complete',
      updatedAt: new Date().toISOString()
    }, { merge: true });

    res.status(200).json({ message: 'Builder profile submitted for verification' });

  } catch (err) {
    console.error("Builder Step 2 Error:", err);
    next(err);
  }
});

module.exports = {router, authenticate};