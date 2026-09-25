const assert = require('node:assert/strict');
const { recoveryEmailConfigured, deliverRecoveryEmail } = require('../hotspot/admin-auth');

(async () => {
  assert.equal(recoveryEmailConfigured({}), false);
  assert.equal(recoveryEmailConfigured({ EMAIL_PROVIDER: 'sendgrid', EMAIL_FROM: 'admin@example.test' }), false);
  const env = { EMAIL_PROVIDER: 'sendgrid', SENDGRID_API_KEY: 'test-key', EMAIL_FROM: 'admin@example.test' };
  assert.equal(recoveryEmailConfigured(env), true);
  const mail = { to: 'recipient@example.test', subject: 'Reset password', text: 'Test reset code' };
  let requests = 0;
  await deliverRecoveryEmail(env, mail, async (url, options) => {
    requests++;
    assert.equal(url, 'https://api.sendgrid.com/v3/mail/send');
    assert.equal(options.headers.Authorization, 'Bearer test-key');
    const body = JSON.parse(options.body);
    assert.equal(body.personalizations[0].to[0].email, mail.to);
    assert.equal(body.from.email, env.EMAIL_FROM);
    assert.equal(body.content[0].value, mail.text);
    return { status: 202 };
  });
  assert.equal(requests, 1);
  await assert.rejects(deliverRecoveryEmail(env, mail, async () => ({ status: 403 })), /HTTP 403/);
  await assert.rejects(deliverRecoveryEmail(env, mail, async () => { throw Error('Timed out'); }), /Timed out/);
  assert.equal(recoveryEmailConfigured({ EMAIL_PROVIDER: 'unknown', ...Object.fromEntries(['SMTP_HOST','SMTP_USER','SMTP_PASSWORD','SMTP_FROM'].map(k=>[k,'value'])) }), false);
  console.log('Recovery email checks passed: configuration, HTTPS payload, provider rejection and timeout. No real emails sent.');
})().catch(error => { console.error(error); process.exitCode = 1; });
