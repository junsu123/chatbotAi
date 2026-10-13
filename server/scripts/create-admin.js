require('dotenv').config();
const readline = require('node:readline/promises');
const { stdin, stdout } = require('node:process');
const { db } = require('../src/common');
const { normalizeEmail, hashPassword, validatePassword } = require('../src/security');
const { ensureDefaultSettings } = require('../src/billing');

async function readVisible(prompt) {
  const rl = readline.createInterface({ input: stdin, output: stdout });
  const value = await rl.question(prompt);
  rl.close();
  return value.trim();
}

function readSecret(prompt) {
  if (!stdin.isTTY || typeof stdin.setRawMode !== 'function') {
    return readVisible(prompt);
  }
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

async function seedPackages() {
  const packages = [
    ['Starter', 50000, 50000, 10],
    ['Shop', 100000, 110000, 20],
    ['Growth', 200000, 230000, 30],
    ['Pro', 500000, 600000, 40],
    ['Business', 1000000, 1250000, 50],
  ];
  for (const [name, priceVnd, credits, sortOrder] of packages) {
    await db.topupPackage.upsert({ where: { name }, create: { name, priceVnd, credits, sortOrder }, update: {} });
  }
}

async function main() {
  console.log('\nMỘC TÂM AI V2.0 - TẠO SUPER ADMIN\n');
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
    create: { email, name, passwordHash, role: 'SUPER_ADMIN', status: 'ACTIVE', wallet: { create: {} } },
    update: { name, passwordHash, role: 'SUPER_ADMIN', status: 'ACTIVE' },
  });
  await db.wallet.upsert({ where: { userId: user.id }, create: { userId: user.id }, update: {} });
  await db.session.deleteMany({ where: { userId: user.id } });
  await db.page.updateMany({ where: { ownerId: null }, data: { ownerId: user.id } });
  await ensureDefaultSettings();
  await seedPackages();

  console.log(`\n✓ Super Admin: ${email}`);
  console.log('✓ Đã tạo ví tín dụng và gán các Page V1 chưa có chủ sở hữu cho Super Admin.');
  console.log('✓ Đã tạo bảng giá mặc định.');
  console.log('Bạn có thể chạy lại lệnh này để đổi mật khẩu Super Admin.\n');
}

main().catch(e => { console.error('\nLỗi:', e.message); process.exitCode = 1; }).finally(async () => { await db.$disconnect(); });
