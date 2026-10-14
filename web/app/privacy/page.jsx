import styles from '../legal.module.css';

export const metadata = {
  title: 'Chính sách quyền riêng tư | Mộc Tâm AI',
  description: 'Chính sách quyền riêng tư của nền tảng Mộc Tâm AI tại metachatbot.online',
};

const sections = [
  ['scope', '1. Phạm vi áp dụng'],
  ['data', '2. Dữ liệu chúng tôi xử lý'],
  ['purpose', '3. Mục đích sử dụng dữ liệu'],
  ['meta', '4. Dữ liệu Facebook / Meta'],
  ['ai', '5. Xử lý bởi AI và nhà cung cấp thứ ba'],
  ['sharing', '6. Chia sẻ dữ liệu'],
  ['security', '7. Bảo mật dữ liệu'],
  ['retention', '8. Thời gian lưu trữ'],
  ['rights', '9. Quyền của người dùng'],
  ['deletion', '10. Xóa dữ liệu'],
  ['children', '11. Người dùng chưa thành niên'],
  ['international', '12. Xử lý dữ liệu xuyên biên giới'],
  ['changes', '13. Thay đổi chính sách'],
  ['contact', '14. Liên hệ'],
];

export default function PrivacyPage() {
  return <div className={styles.page}>
    <header className={styles.header}>
      <div className={styles.headerInner}>
        <div className={styles.brand}>✦ MỘC TÂM AI</div>
        <nav className={styles.nav}>
          <a href="/">Trang chủ</a>
          <a href="/privacy">Quyền riêng tư</a>
          <a href="/terms">Điều khoản</a>
        </nav>
      </div>
    </header>

    <section className={styles.hero}>
      <span className={styles.eyebrow}>Pháp lý & dữ liệu</span>
      <h1>Chính sách quyền riêng tư</h1>
      <p className={styles.lead}>Chính sách này giải thích cách Mộc Tâm AI thu thập, sử dụng, lưu trữ và bảo vệ dữ liệu khi bạn sử dụng nền tảng tại <strong>metachatbot.online</strong>, bao gồm tính năng kết nối Facebook Page, Messenger và trợ lý AI.</p>
      <div className={styles.updated}>Cập nhật lần cuối: 14/10/2026</div>
    </section>

    <main className={styles.layout}>
      <aside className={styles.toc}>
        <div className={styles.tocTitle}>Mục lục</div>
        {sections.map(([id, label]) => <a key={id} href={`#${id}`}>{label}</a>)}
      </aside>

      <article className={styles.content}>
        <section id="scope" className={styles.section}>
          <h2>1. Phạm vi áp dụng</h2>
          <p>Chính sách này áp dụng cho người dùng tạo tài khoản Mộc Tâm AI, quản trị viên hệ thống, doanh nghiệp hoặc cá nhân kết nối Facebook Page, và những dữ liệu được xử lý để cung cấp dịch vụ trả lời tin nhắn tự động bằng AI.</p>
          <div className={styles.notice}>Mộc Tâm AI là công cụ hỗ trợ vận hành hội thoại cho Page. Người dùng chịu trách nhiệm bảo đảm mình có quyền hợp pháp để kết nối Page, xử lý nội dung hội thoại và sử dụng dữ liệu khách hàng của Page.</div>
        </section>

        <section id="data" className={styles.section}>
          <h2>2. Dữ liệu chúng tôi xử lý</h2>
          <h3>Dữ liệu tài khoản</h3>
          <ul>
            <li>Tên hiển thị, địa chỉ email và thông tin đăng nhập đã được băm bảo mật.</li>
            <li>Vai trò tài khoản, trạng thái tài khoản, phiên đăng nhập và thời điểm hoạt động.</li>
          </ul>
          <h3>Dữ liệu vận hành dịch vụ</h3>
          <ul>
            <li>Cấu hình Fanpage, prompt, dữ liệu sản phẩm, giá sản phẩm và cài đặt AI do người dùng nhập.</li>
            <li>Nội dung hội thoại Messenger cần thiết để tạo câu trả lời và hiển thị lịch sử hội thoại.</li>
            <li>Thông tin sử dụng AI như model, số token, số AI Unit, trạng thái xử lý và chi phí kỹ thuật ước tính.</li>
            <li>Nhật ký kỹ thuật cần thiết cho bảo mật, chẩn đoán lỗi và chống lạm dụng.</li>
          </ul>
          <h3>Dữ liệu đơn dịch vụ</h3>
          <p>Hệ thống có thể lưu mã đơn, gói dịch vụ, số tiền, trạng thái thanh toán và thời hạn thuê bao. Mộc Tâm AI không yêu cầu lưu mật khẩu ngân hàng hoặc thông tin đăng nhập tài khoản thanh toán của khách hàng.</p>
        </section>

        <section id="purpose" className={styles.section}>
          <h2>3. Mục đích sử dụng dữ liệu</h2>
          <p>Chúng tôi xử lý dữ liệu để cung cấp và vận hành dịch vụ, xác thực tài khoản, kết nối Facebook Page, nhận và phản hồi tin nhắn, tạo nội dung bằng AI, tính hạn mức sử dụng, bảo mật hệ thống, hỗ trợ người dùng, xử lý lỗi, ngăn chặn gian lận và cải thiện chất lượng dịch vụ.</p>
        </section>

        <section id="meta" className={styles.section}>
          <h2>4. Dữ liệu Facebook / Meta</h2>
          <p>Khi bạn chủ động chọn “Kết nối với Facebook”, Mộc Tâm AI có thể nhận dữ liệu do Meta cung cấp theo các quyền bạn chấp thuận, bao gồm:</p>
          <ul>
            <li>ID và tên Facebook Page mà tài khoản của bạn có quyền quản lý.</li>
            <li>Page Access Token cần thiết để thực hiện chức năng Messenger. Token này không được hiển thị công khai cho người dùng khác.</li>
            <li>Sender ID, Page ID, message ID và nội dung tin nhắn gửi đến Page khi cần để xử lý hội thoại.</li>
            <li>Thông tin liên quan khác trong phạm vi quyền Facebook/Meta mà bạn đã cấp.</li>
          </ul>
          <p>Bạn có thể ngắt kết nối Page hoặc thu hồi quyền của ứng dụng từ cài đặt Facebook/Meta. Việc thu hồi quyền có thể làm các tính năng tự động trả lời ngừng hoạt động.</p>
        </section>

        <section id="ai" className={styles.section}>
          <h2>5. Xử lý bởi AI và nhà cung cấp thứ ba</h2>
          <p>Để tạo câu trả lời, Mộc Tâm AI có thể gửi nội dung tin nhắn, prompt, lịch sử hội thoại gần đây và dữ liệu sản phẩm liên quan đến nhà cung cấp mô hình AI được hệ thống cấu hình. Chúng tôi cố gắng chỉ gửi lượng dữ liệu cần thiết cho mục đích tạo phản hồi.</p>
          <p>Dịch vụ cũng phụ thuộc vào các nền tảng bên thứ ba như Meta/Facebook, OpenAI hoặc nhà cung cấp hạ tầng. Việc xử lý của các bên này còn chịu sự điều chỉnh bởi điều khoản và chính sách riêng của họ.</p>
        </section>

        <section id="sharing" className={styles.section}>
          <h2>6. Chia sẻ dữ liệu</h2>
          <p>Chúng tôi không bán dữ liệu cá nhân. Dữ liệu chỉ được chia sẻ khi cần thiết để vận hành dịch vụ, thực hiện yêu cầu của người dùng, tuân thủ nghĩa vụ pháp lý, bảo vệ hệ thống hoặc làm việc với nhà cung cấp xử lý dữ liệu phục vụ hạ tầng, nhắn tin và AI.</p>
        </section>

        <section id="security" className={styles.section}>
          <h2>7. Bảo mật dữ liệu</h2>
          <p>Chúng tôi áp dụng các biện pháp kỹ thuật hợp lý như HTTPS, phân quyền tài khoản, cô lập dữ liệu giữa người dùng, session bảo mật và mã hóa các bí mật nhạy cảm ở phía máy chủ. OpenAI API Key và Facebook Page Access Token được thiết kế để lưu dưới dạng mã hóa và không được trả lại nguyên bản cho trình duyệt.</p>
          <p>Không có hệ thống nào có thể bảo đảm an toàn tuyệt đối. Người dùng có trách nhiệm giữ bí mật thông tin đăng nhập và thông báo cho chúng tôi khi nghi ngờ tài khoản bị truy cập trái phép.</p>
        </section>

        <section id="retention" className={styles.section}>
          <h2>8. Thời gian lưu trữ</h2>
          <p>Dữ liệu được lưu trong thời gian cần thiết để cung cấp dịch vụ, giải quyết tranh chấp, bảo đảm an ninh, đáp ứng nghĩa vụ kế toán hoặc pháp lý và thực hiện các mục đích được nêu trong chính sách này. Khi dữ liệu không còn cần thiết, chúng tôi có thể xóa, ẩn danh hoặc giới hạn xử lý theo quy trình vận hành phù hợp.</p>
        </section>

        <section id="rights" className={styles.section}>
          <h2>9. Quyền của người dùng</h2>
          <p>Tùy quy định pháp luật áp dụng, bạn có thể yêu cầu truy cập, chỉnh sửa, cập nhật, giới hạn xử lý hoặc xóa dữ liệu của mình; rút lại quyền đã cấp; ngắt kết nối Facebook Page; hoặc yêu cầu thông tin về cách dữ liệu được xử lý.</p>
          <p>Một số yêu cầu có thể cần xác minh danh tính hoặc quyền quản trị Page trước khi được thực hiện.</p>
        </section>

        <section id="deletion" className={styles.section}>
          <h2>10. Xóa dữ liệu</h2>
          <p>Bạn có thể ngừng xử lý dữ liệu Facebook bằng cách ngắt kết nối Page và thu hồi quyền của ứng dụng trên Facebook. Nếu muốn xóa dữ liệu đã lưu trong Mộc Tâm AI, hãy gửi yêu cầu qua kênh hỗ trợ được công bố trên <a className={styles.link} href="https://metachatbot.online">metachatbot.online</a>.</p>
          <p>Sau khi xác minh yêu cầu hợp lệ, chúng tôi sẽ xử lý việc xóa hoặc ẩn danh dữ liệu thuộc phạm vi yêu cầu, ngoại trừ dữ liệu cần được giữ lại do nghĩa vụ pháp lý, phòng chống gian lận hoặc bảo vệ quyền lợi hợp pháp.</p>
        </section>

        <section id="children" className={styles.section}>
          <h2>11. Người dùng chưa thành niên</h2>
          <p>Dịch vụ được thiết kế cho cá nhân hoặc tổ chức sử dụng công cụ quản trị kinh doanh và không hướng đến trẻ em. Người dùng phải có đủ năng lực pháp lý để chấp nhận các điều khoản áp dụng cho tài khoản của mình.</p>
        </section>

        <section id="international" className={styles.section}>
          <h2>12. Xử lý dữ liệu xuyên biên giới</h2>
          <p>Một số nhà cung cấp hạ tầng, Meta/Facebook hoặc nhà cung cấp AI có thể xử lý dữ liệu tại quốc gia khác nơi bạn cư trú. Khi sử dụng dịch vụ, bạn hiểu rằng việc truyền và xử lý dữ liệu như vậy có thể xảy ra trong phạm vi cần thiết để cung cấp chức năng mà bạn yêu cầu.</p>
        </section>

        <section id="changes" className={styles.section}>
          <h2>13. Thay đổi chính sách</h2>
          <p>Chúng tôi có thể cập nhật Chính sách quyền riêng tư khi tính năng, nhà cung cấp, mô hình kinh doanh hoặc yêu cầu pháp lý thay đổi. Phiên bản mới sẽ được công bố tại URL này cùng ngày cập nhật.</p>
        </section>

        <section id="contact" className={styles.section}>
          <h2>14. Liên hệ</h2>
          <p><span className={styles.strong}>Dịch vụ:</span> Mộc Tâm AI / Meta Chatbot</p>
          <p><span className={styles.strong}>Website:</span> <a className={styles.link} href="https://metachatbot.online">https://metachatbot.online</a></p>
          <p>Đối với yêu cầu về dữ liệu cá nhân, quyền riêng tư hoặc xóa dữ liệu, vui lòng sử dụng kênh hỗ trợ được công bố trên website hoặc trong tài khoản Mộc Tâm AI của bạn.</p>
        </section>
      </article>
    </main>

    <footer className={styles.footer}>
      <div className={styles.footerInner}>
        <span>© 2026 Mộc Tâm AI. All rights reserved.</span>
        <div className={styles.footerLinks}><a href="/privacy">Chính sách quyền riêng tư</a><a href="/terms">Điều khoản dịch vụ</a></div>
      </div>
    </footer>
  </div>;
}
