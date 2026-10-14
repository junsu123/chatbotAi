import './style.css';
import EmailOnlyOtpGuard from './EmailOnlyOtpGuard';

export const metadata = {
  title: 'Mộc Tâm AI V2.2',
  description: 'Subscription-based Facebook Messenger AI platform',
};

export default function Layout({ children }) {
  return <html lang="vi"><body><EmailOnlyOtpGuard />{children}</body></html>;
}
