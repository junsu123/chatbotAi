require('dotenv').config();
const readline = require('node:readline/promises');
const { stdin, stdout } = require('node:process');
const { PrismaClient } = require('@prisma/client');
const { normalizeEmail, hashPassword, validatePassword } = require('../src/security');
const db = new PrismaClient();

const DEFAULT_SETTINGS = {
  signup_enabled: 'true',
  openai_model: 'gpt-4.1-mini',
  openai_input_usd_per_million: '0.40',
  openai_output_usd_per_million: '1.60',
  usd_to_vnd: '25910',
  ai_max_output_tokens: '400',
  ai_tokens_per_unit: '2500',
  ai_max_units_per_reply: '3',
};

async function readVisible(prompt) {
  const rl = readline.createInterface({ input: stdin, output: stdout });
  const value = await rl.question(prompt);
  rl.close();
  return value.trim();
}

function readSecret(prompt) {
  if (!stdin.isTTY || typeof stdin.setRawMode !== 'function') return readVisible(prompt);
  return new Promise((resolve, reject) => {
    let value = '';
    stdout.write(prompt);
    stdin.setRawMode(true);
    stdin.resume();
    stdin.setEncoding('utf8');
    const cleanup = () => {
      try { stdin.setRawMode(false); } catch {}
      stdin.pause();
      stdin.removeListener('data', onData);
      stdout.write('\n');
    };
    const onData = ch => {
      if (ch === '\u0003') { cleanup(); reject(new Error('Đã hủy')); return; }
      if (ch === '\r' || ch === '\n') { cleanup(); resolve(value); return; }
      if (ch === '\u007f' || ch === '\b') {
        if (value.length) { value = value.slice(0, -1); stdout.write('\b \b'); }
        return;
      }
      if (ch >= ' ') { value += ch; stdout.write('*'); }
    };
    stdin.on('data', onData);
  });
}

async function seedSettings() {
  for (const [key, value] of Object.entries(DEFAULT_SETTINGS)) {
    await db.systemSetting.upsert({ where: { key }, create: { key, value }, update: {} });
  }
}

async function seedPlans() {
  const plans = [
    { name: 'Mini', type: 'SUBSCRIPTION', priceVnd: 99000, units: 3000, durationDays: 30, maxPages: 1, sortOrder: 10 },
    { name: 'Shop', type: 'SUBSCRIPTION', priceVnd: 199000, units: 8000, durationDays: 30, maxPages: 3, sortOrder: 20 },
    { name: 'Pro', type: 'SUBSCRIPTION', priceVnd: 399000, units: 20000, durationDays: 30, maxPages: 10, sortOrder: 30 },
    { name: 'Business', type: 'SUBSCRIPTION', priceVnd: 799000, units: 50000, durationDays: 30, maxPages: 30, sortOrder: 40 },
    { name: 'Add-on 2.000', type: 'ADDON', priceVnd: 59000, units: 2000, durationDays: 0, maxPages: 0, sortOrder: 110 },
    { name: 'Add-on 5.000', type: 'ADDON', priceVnd: 129000, units: 5000, durationDays: 0, maxPages: 0, sortOrder: 120 },
    { name: 'Add-on 10.000', type: 'ADDON', priceVnd: 229000, units: 10000, durationDays: 0, maxPages: 0, sortOrder: 130 },
  ];
  for (const plan of plans) {
    await db.servicePlan.upsert({ where: { name: plan.name }, create: plan, update: { ...plan, active: true } });
  }
}

async function main() {
  console.log('\nMỘC TÂM AI V2.1 - TẠO SUPER ADMIN\n');
  const email = normalizeEmail(await readVisible('Email admin: '));
  if (!/^\S+@\S+\.\S+$/.test(email)) throw new Error('Email không hợp lệ');
  const name = (await readVisible('Tên hiển thị [Super Admin]: ')) || 'Super Admin';
  const password = await readSecret('Mật khẩu (>=10 ký tự): ');
  validatePassword(password);
  const confirm = await readSecret('Nhập lại mật khẩu: ');
  if (password !== confirm) throw new Error('Hai mật khẩu không khớp');
  const passwordHash = await hashPassword(password);

  const user = await db.user.upsert({
    where: { email },
    create: { email, name, passwordHash, role: 'SUPER_ADMIN', status: 'ACTIVE' },
    update: { name, passwordHash, role: 'SUPER_ADMIN', status: 'ACTIVE' },
  });
  await db.session.deleteMany({ where: { userId: user.id } });
  await db.page.updateMany({ where: { ownerId: null }, data: { ownerId: user.id } });
  await seedSettings();
  await seedPlans();

  console.log(`\n✓ Super Admin: ${email}`);
  console.log('✓ Không tạo ví tiền hoặc số dư tiền cho người dùng.');
  console.log('✓ Đã seed gói thuê bao và add-on AI Unit mặc định.');
  console.log('✓ Các Page cũ chưa có chủ sở hữu đã được gán cho Super Admin.');
  console.log('Bạn có thể chạy lại lệnh này để đổi mật khẩu Super Admin.\n');
}

main().catch(e => { console.error('\nLỗi:', e.message); process.exitCode = 1; }).finally(async () => { await db.$disconnect(); });
