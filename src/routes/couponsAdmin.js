const express = require("express");
const { getDb } = require("../firebase");
const { z } = require("zod");

const router = express.Router();

// Validation schema for creating a coupon
const couponSchema = z.object({
  code: z.string().min(3),
  discountAmount: z.number().positive(),
  type: z.enum(["custom", "launch"]).optional().default("custom"),
  assignedTo: z.string().optional().nullable(),
  maxUses: z.number().int().positive().optional().default(1),
  validFrom: z.string().datetime().optional().nullable(),
  validUntil: z.string().datetime().optional().nullable(),
});

/**
 * GET /api/admin/coupons
 * Fetch all coupons
 */
router.get("/", async (req, res) => {
  try {
    const db = getDb();
    const snapshot = await db
      .collection("coupons")
      .orderBy("createdAt", "desc")
      .get();
    const coupons = snapshot.docs.map((doc) => ({ id: doc.id, ...doc.data() }));
    res.json({ data: coupons });
  } catch (err) {
    console.error("Fetch coupons error:", err);
    res.status(500).json({ message: "Failed to fetch coupons" });
  }
});

/**
 * POST /api/admin/coupons
 * Create a new custom coupon
 */
router.post("/", async (req, res) => {
  try {
    const parsed = couponSchema.safeParse(req.body);
    if (!parsed.success) {
      return res
        .status(400)
        .json({ message: "Validation error", errors: parsed.error.flatten() });
    }

    const db = getDb();
    const {
      code,
      discountAmount,
      type,
      assignedTo,
      maxUses,
      validFrom,
      validUntil,
    } = parsed.data;

    // Check if code already exists
    const existing = await db
      .collection("coupons")
      .where("code", "==", code)
      .get();
    if (!existing.empty) {
      return res.status(400).json({ message: "Coupon code already exists" });
    }

    const couponData = {
      code: code.toUpperCase(),
      discountAmount,
      type,
      assignedTo: assignedTo ? assignedTo.trim() : null,
      maxUses,
      usedCount: 0,
      validFrom: validFrom || null,
      validUntil: validUntil || null,
      status: "active",
      createdAt: new Date().toISOString(),
    };

    const docRef = await db.collection("coupons").add(couponData);

    // If coupon is assigned to a specific user, emit a socket event and notify them
    if (couponData.assignedTo) {
      const socketService = require("../services/SocketService");
      socketService.emitCouponToUser(couponData.assignedTo, { id: docRef.id, ...couponData });

      try {
        const { notifyUser, NOTIFICATION_TYPES } = require("../utils/notificationHelper");
        await notifyUser(
          couponData.assignedTo,
          NOTIFICATION_TYPES.COUPON_ASSIGNED,
          'New Discount Coupon Assigned!',
          `Good news! You have been assigned a new promo coupon: "${couponData.code}". You can use it to get $${couponData.discountAmount} off on your next advertisement campaign booking.`,
          null,
          { couponId: docRef.id, code: couponData.code }
        );
      } catch (notifErr) {
        console.error('[CouponsAdmin] Failed to write coupon notification:', notifErr.message);
      }
    }

    res
      .status(201)
      .json({
        message: "Coupon created",
        data: { id: docRef.id, ...couponData },
      });
  } catch (err) {
    console.error("Create coupon error:", err);
    res.status(500).json({ message: "Failed to create coupon" });
  }
});

/**
 * DELETE /api/admin/coupons/:id
 * Delete a coupon
 */
router.delete("/:id", async (req, res) => {
  try {
    const db = getDb();
    const { id } = req.params;
    await db.collection("coupons").doc(id).delete();
    res.json({ message: "Coupon deleted successfully" });
  } catch (err) {
    console.error("Delete coupon error:", err);
    res.status(500).json({ message: "Failed to delete coupon" });
  }
});

/**
 * PATCH /api/admin/coupons/:id/reset
 * Reset usedCount to 0 (for admin to fix stuck coupons)
 */
router.patch("/:id/reset", async (req, res) => {
  try {
    const db = getDb();
    const { id } = req.params;
    const ref = db.collection("coupons").doc(id);
    const doc = await ref.get();
    if (!doc.exists) {
      return res.status(404).json({ message: "Coupon not found" });
    }
    await ref.update({ usedCount: 0, updatedAt: new Date().toISOString() });
    res.json({ message: "Coupon usage count reset to 0 successfully" });
  } catch (err) {
    console.error("Reset coupon error:", err);
    res.status(500).json({ message: "Failed to reset coupon" });
  }
});

module.exports = router;
