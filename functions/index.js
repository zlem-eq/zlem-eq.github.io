const { onSchedule } = require("firebase-functions/v2/scheduler");
const { initializeApp } = require("firebase-admin/app");
const { getFirestore, Timestamp } = require("firebase-admin/firestore");

initializeApp();

exports.deleteOldCompletedOrders = onSchedule("every 24 hours", async () => {
    const db = getFirestore();
    const cutoff = Timestamp.fromDate(
        new Date(Date.now() - 10 * 24 * 60 * 60 * 1000)
    );

    const snap = await db.collection("orders")
        .where("status", "==", "complete")
        .where("orderedAt", "<", cutoff)
        .get();

    if (snap.empty) {
        console.log("No old completed orders to delete.");
        return;
    }

    const batch = db.batch();
    snap.docs.forEach(d => batch.delete(d.ref));
    await batch.commit();

    console.log(`Deleted ${snap.size} old completed orders.`);
});