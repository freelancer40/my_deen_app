/* ==============================================================
   save-subscription — ব্যবহারকারীর Push Subscription + লোকেশন/মাযহাব
   সেটিংস সংরক্ষণ করে, যাতে check-waqt.js প্রতি মিনিটে চেক করে সঠিক
   সময়ে ঠিক এই ব্যবহারকারীর জন্য পুশ নোটিফিকেশন পাঠাতে পারে।
   ============================================================== */
const { connectLambda, getStore } = require('@netlify/blobs');
const crypto = require('crypto');

exports.handler = async function (event) {
  connectLambda(event);

  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: 'Method Not Allowed' };
  }

  try {
    const body = JSON.parse(event.body || '{}');
    const subscription = body.subscription;

    if (!subscription || !subscription.endpoint || !subscription.keys) {
      return {
        statusCode: 400,
        body: JSON.stringify({ error: 'invalid subscription object' })
      };
    }

    const id = crypto.createHash('sha256').update(subscription.endpoint).digest('hex');
    const store = getStore('push-subs');

    await store.setJSON(id, {
      subscription: subscription,
      district_en: body.district_en || 'Dhaka',
      district_bn: body.district_bn || 'ঢাকা',
      upazila: body.upazila || '',
      madhab: body.madhab || 'hanafi',
      updatedAt: new Date().toISOString()
    });

    return {
      statusCode: 200,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ok: true, id: id })
    };
  } catch (e) {
    return {
      statusCode: 500,
      body: JSON.stringify({ error: String((e && e.message) || e) })
    };
  }
};
