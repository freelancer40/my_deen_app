/* ==============================================================
   delete-subscription — ব্যবহারকারী নোটিফিকেশন বন্ধ করলে বা ব্রাউজার
   সাবস্ক্রিপশন বাতিল করলে সেটা স্টোর থেকে মুছে ফেলে।
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
    const endpoint = body.endpoint;
    if (!endpoint) {
      return { statusCode: 400, body: JSON.stringify({ error: 'endpoint required' }) };
    }
    const id = crypto.createHash('sha256').update(endpoint).digest('hex');
    const store = getStore('push-subs');
    await store.delete(id);

    return {
      statusCode: 200,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ok: true })
    };
  } catch (e) {
    return {
      statusCode: 500,
      body: JSON.stringify({ error: String((e && e.message) || e) })
    };
  }
};
