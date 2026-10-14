'use client';

import { useEffect } from 'react';

const TEXT_REPLACEMENTS = [
  ['Nhận mã xác nhận qua email hoặc số điện thoại đã xác minh.', 'Mã xác nhận chỉ được gửi qua email của tài khoản.'],
  ['Mã SMS', 'Mã xác nhận email'],
  ['Gửi mã SMS', 'Gửi mã qua email'],
  ['Thay đổi / xác minh số điện thoại', 'Thay đổi số điện thoại'],
  ['Xác minh đăng ký qua', 'Mã xác nhận đăng ký'],
];

export default function EmailOnlyOtpGuard() {
  useEffect(() => {
    let applying = false;

    const apply = () => {
      if (applying) return;
      applying = true;
      try {
        document.querySelectorAll('option[value="SMS"]').forEach(option => {
          const select = option.parentElement;
          option.remove();
          if (select && select.querySelector('option[value="EMAIL"]')) {
            select.value = 'EMAIL';
            select.dispatchEvent(new Event('change', { bubbles: true }));
          }
        });

        const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
        const nodes = [];
        while (walker.nextNode()) nodes.push(walker.currentNode);
        for (const node of nodes) {
          let value = node.nodeValue || '';
          let next = value;
          for (const [from, to] of TEXT_REPLACEMENTS) next = next.replaceAll(from, to);
          if (next !== value) node.nodeValue = next;
        }

        document.querySelectorAll('.contactLine').forEach(row => {
          const title = row.querySelector('b');
          if (title?.textContent?.trim() !== 'Số điện thoại') return;
          const badge = row.querySelector('.verifyBadge');
          if (!badge) return;
          const hasPhone = !row.textContent.includes('Chưa có');
          const wanted = hasPhone ? '✓ Đã lưu' : 'Bắt buộc';
          if (badge.textContent !== wanted) badge.textContent = wanted;
          badge.classList.remove('unverified');
          badge.classList.add(hasPhone ? 'verified' : 'unverified');
        });
      } finally {
        applying = false;
      }
    };

    apply();
    const observer = new MutationObserver(apply);
    observer.observe(document.body, { subtree: true, childList: true, characterData: true });
    return () => observer.disconnect();
  }, []);

  return null;
}
