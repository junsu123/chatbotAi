import styles from '../legal.module.css';

export const metadata = {
  title: 'Điều khoản dịch vụ | Mộc Tâm AI',
  description: 'Điều khoản dịch vụ của nền tảng Mộc Tâm AI tại metachatbot.online',
};

const sections = [
  ['acceptance', '1. Chấp nhận điều khoản'],
  ['service', '2. Mô tả dịch vụ'],
  ['account', '3. Tài khoản và bảo mật'],
  ['meta', '4. Kết nối Facebook / Meta'],
  ['ai', '5. Nội dung do AI tạo'],
  ['usage', '6. Sử dụng được phép'],
  ['plans', '7. Gói dịch vụ và AI Unit'],
  ['payment', '8. Thanh toán và hoàn tiền'],
  ['thirdparty', '9. Dịch vụ bên thứ ba'],
  ['data', '10. Dữ liệu và quyền riêng tư'],
  ['availability', '11. Tính sẵn sàng của dịch vụ'],
  ['suspension', '12. Tạm ngưng và chấm dứt'],
  ['ip', '13. Quyền sở hữu trí tuệ'],
  ['liability', '14. Giới hạn trách nhiệm'],
  ['changes', '15. Thay đổi điều khoản'],
  ['law', '16. Luật áp dụng'],
  ['contact', '17. Liên hệ'],
];

export default function TermsPage() {
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
      <span className={styles.eyebrow}>Điều kiện sử dụng</span>
      <h1>Điều khoản dịch vụ</h1>
      <p className={styles.lead}>Điều khoản này điều chỉnh việc truy cập và sử dụng Mộc Tâm AI tại <strong>metachatbot.online</strong>, bao gồm tính năng quản lý Facebook Page, Messenger, trợ lý AI, gói thuê bao và AI Usage Quota.</p>
      <div className={styles.updated}>Cập nhật lần cuối: 14/10/2026</div>
    </section>

    <main className={styles.layout}>
      <aside className={styles.toc}>
        <div className={styles.tocTitle}>Mục lục</div>
        {sections.map(([id, label]) => <a key={id} href={`#${id}`}>{label}</a>)}
      </aside>

      <article className={styles.content}>
        <section id="acceptance" className={styles.section}>
          <h2>1. Chấp nhận điều khoản</h2>
          <p>Bằng việc tạo tài khoản, đăng nhập, kết nối Facebook Page, mua gói dịch vụ hoặc tiếp tục sử dụng Mộc Tâm AI, bạn xác nhận đã đọc và đồng ý với Điều khoản dịch vụ này cùng <a className={styles.link} href="/privacy">Chính sách quyền riêng tư</a>.</p>
          <p>Nếu bạn sử dụng dịch vụ thay mặt tổ chức hoặc doanh nghiệp, bạn xác nhận mình có thẩm quyền chấp nhận các điều khoản này thay mặt tổ chức đó.</p>
        </section>

        <section id="service" className={styles.section}>
          <h2>2. Mô tả dịch vụ</h2>
          <p>Mộc Tâm AI cung cấp công cụ hỗ trợ quản lý và tự động phản hồi hội thoại trên các kênh được tích hợp, bao gồm Facebook Messenger. Tính năng có thể bao gồm kết nối Facebook Page, quản lý hội thoại, dữ liệu sản phẩm, prompt theo Page, tạo phản hồi bằng AI, theo dõi mức sử dụng và quản lý gói dịch vụ.</p>
          <div className={styles.notice}>Dịch vụ là công cụ hỗ trợ vận hành. Mộc Tâm AI không thay thế việc kiểm tra của con người đối với các nội dung quan trọng, thông tin pháp lý, y tế, tài chính hoặc các cam kết thương mại có rủi ro cao.</div>
        </section>

        <section id="account" className={styles.section}>
          <h2>3. Tài khoản và bảo mật</h2>
          <ul>
            <li>Bạn phải cung cấp thông tin tài khoản chính xác và giữ thông tin đăng nhập an toàn.</li>
            <li>Bạn chịu trách nhiệm đối với hoạt động phát sinh từ tài khoản của mình, trừ trường hợp pháp luật quy định khác.</li>
            <li>Bạn phải thông báo khi phát hiện truy cập trái phép, mất quyền kiểm soát tài khoản hoặc nghi ngờ thông tin xác thực bị lộ.</li>
            <li>Chúng tôi có thể yêu cầu xác minh thêm khi có dấu hiệu gian lận, lạm dụng hoặc tranh chấp quyền sở hữu Page.</li>
          </ul>
        </section>

        <section id="meta" className={styles.section}>
          <h2>4. Kết nối Facebook / Meta</h2>
          <p>Bạn chỉ được kết nối Facebook Page mà mình có quyền quản trị hoặc quyền hợp pháp tương ứng. Khi kết nối, bạn cho phép Mộc Tâm AI thực hiện các tác vụ trong phạm vi quyền Meta mà bạn chấp thuận, chẳng hạn lấy danh sách Page, đăng ký webhook, nhận tin nhắn và gửi phản hồi qua Messenger.</p>
          <p>Bạn hiểu rằng Meta/Facebook là dịch vụ bên thứ ba độc lập. Các thay đổi về API, quyền truy cập, App Review, chính sách nền tảng, giới hạn nhắn tin hoặc việc Meta đình chỉ quyền truy cập có thể ảnh hưởng đến Mộc Tâm AI mà không thuộc quyền kiểm soát trực tiếp của chúng tôi.</p>
        </section>

        <section id="ai" className={styles.section}>
          <h2>5. Nội dung do AI tạo</h2>
          <p>Phản hồi AI được tạo dựa trên prompt, lịch sử hội thoại, dữ liệu sản phẩm và thông tin được cung cấp cho hệ thống. Nội dung AI có thể không chính xác, không đầy đủ hoặc không phù hợp với mọi tình huống.</p>
          <p>Bạn chịu trách nhiệm cấu hình prompt, dữ liệu sản phẩm, chính sách trả lời và giám sát kết quả trước khi sử dụng cho mục đích có rủi ro cao. Không được dùng dịch vụ để tạo thông tin gây hiểu nhầm, tuyên bố chữa bệnh không có cơ sở, gian lận, lừa đảo hoặc nội dung vi phạm pháp luật.</p>
        </section>

        <section id="usage" className={styles.section}>
          <h2>6. Sử dụng được phép</h2>
          <p>Bạn đồng ý không sử dụng dịch vụ để:</p>
          <ul>
            <li>Vi phạm pháp luật, quyền riêng tư, quyền sở hữu trí tuệ hoặc quyền hợp pháp của người khác.</li>
            <li>Gửi spam, lừa đảo, phát tán mã độc hoặc thực hiện hành vi truy cập trái phép.</li>
            <li>Can thiệp, dò quét, phá hoại, vượt giới hạn kỹ thuật hoặc cố gắng truy cập dữ liệu của tài khoản khác.</li>
            <li>Thu thập hoặc xử lý dữ liệu cá nhân mà không có cơ sở hợp pháp hoặc quyền cần thiết.</li>
            <li>Lạm dụng Messenger, Meta API hoặc các dịch vụ bên thứ ba theo cách vi phạm chính sách của họ.</li>
          </ul>
        </section>

        <section id="plans" className={styles.section}>
          <h2>7. Gói dịch vụ và AI Unit</h2>
          <p>Mộc Tâm AI có thể cung cấp các gói thuê bao theo thời hạn, giới hạn số Page và hạn mức sử dụng AI. <strong>AI Unit là đơn vị quyền sử dụng dịch vụ, không phải tiền, không phải ví điện tử và không có chức năng rút hoặc chuyển cho tài khoản khác.</strong></p>
          <p>Mức tiêu hao AI Unit có thể phụ thuộc vào lượng token, cấu hình model hoặc quy tắc kỹ thuật được công bố trong hệ thống. Gói bổ sung hoặc add-on có thể có thời hạn gắn với kỳ thuê bao hiện tại.</p>
          <p>Khi gói hết hạn hoặc hết hạn mức, chức năng gọi AI có thể bị tạm dừng cho đến khi người dùng gia hạn, nâng cấp hoặc mua quyền sử dụng bổ sung.</p>
        </section>

        <section id="payment" className={styles.section}>
          <h2>8. Thanh toán và hoàn tiền</h2>
          <p>Giá, thời hạn, hạn mức và điều kiện của từng gói được hiển thị tại thời điểm đặt mua. Người dùng có trách nhiệm kiểm tra thông tin trước khi xác nhận thanh toán.</p>
          <p>Việc hoàn tiền, nếu có, phụ thuộc vào chính sách bán hàng được công bố tại thời điểm giao dịch, tình trạng kích hoạt dịch vụ và quy định pháp luật áp dụng. Các khoản phí của nhà cung cấp thanh toán hoặc ngân hàng có thể chịu điều khoản riêng của bên thứ ba.</p>
        </section>

        <section id="thirdparty" className={styles.section}>
          <h2>9. Dịch vụ bên thứ ba</h2>
          <p>Mộc Tâm AI phụ thuộc vào một số dịch vụ bên thứ ba như Meta/Facebook, nhà cung cấp mô hình AI, hạ tầng máy chủ, DNS, chứng chỉ SSL và các nhà cung cấp thanh toán nếu được tích hợp. Chúng tôi không kiểm soát hoàn toàn tính sẵn sàng, điều khoản hoặc thay đổi chính sách của các dịch vụ đó.</p>
        </section>

        <section id="data" className={styles.section}>
          <h2>10. Dữ liệu và quyền riêng tư</h2>
          <p>Việc xử lý dữ liệu được mô tả chi tiết trong <a className={styles.link} href="/privacy">Chính sách quyền riêng tư</a>. Bạn chịu trách nhiệm bảo đảm có quyền hợp pháp đối với dữ liệu sản phẩm, nội dung hội thoại và dữ liệu khách hàng mà mình đưa vào hệ thống.</p>
        </section>

        <section id="availability" className={styles.section}>
          <h2>11. Tính sẵn sàng của dịch vụ</h2>
          <p>Chúng tôi cố gắng duy trì dịch vụ ổn định nhưng không cam kết hệ thống luôn không gián đoạn hoặc không có lỗi. Bảo trì, sự cố hạ tầng, giới hạn API, thay đổi từ Meta/OpenAI, tấn công mạng hoặc sự kiện ngoài khả năng kiểm soát có thể làm dịch vụ tạm thời không khả dụng.</p>
        </section>

        <section id="suspension" className={styles.section}>
          <h2>12. Tạm ngưng và chấm dứt</h2>
          <p>Chúng tôi có thể tạm ngưng hoặc chấm dứt quyền truy cập khi tài khoản vi phạm điều khoản, không thanh toán khoản đến hạn, gây rủi ro an ninh, có dấu hiệu gian lận hoặc khi việc tiếp tục cung cấp dịch vụ có thể vi phạm pháp luật hoặc chính sách nền tảng.</p>
          <p>Người dùng có thể ngừng sử dụng dịch vụ và ngắt kết nối Facebook Page bất kỳ lúc nào. Một số dữ liệu có thể tiếp tục được lưu trong thời gian hợp lý theo Chính sách quyền riêng tư hoặc nghĩa vụ pháp lý.</p>
        </section>

        <section id="ip" className={styles.section}>
          <h2>13. Quyền sở hữu trí tuệ</h2>
          <p>Phần mềm, giao diện, thương hiệu, tài liệu và thành phần do Mộc Tâm AI tạo ra thuộc quyền của chủ sở hữu tương ứng và được bảo vệ theo pháp luật áp dụng. Người dùng vẫn giữ quyền đối với dữ liệu, nội dung sản phẩm và nội dung riêng mà họ cung cấp, trong phạm vi họ có quyền hợp pháp đối với các nội dung đó.</p>
        </section>

        <section id="liability" className={styles.section}>
          <h2>14. Giới hạn trách nhiệm</h2>
          <p>Trong phạm vi pháp luật cho phép, Mộc Tâm AI không chịu trách nhiệm đối với thiệt hại gián tiếp, mất lợi nhuận, mất dữ liệu do hành vi của người dùng, nội dung AI không được kiểm tra, gián đoạn từ dịch vụ bên thứ ba hoặc việc tài khoản Meta/Page bị hạn chế do vi phạm chính sách nền tảng.</p>
          <p>Không nội dung nào trong điều khoản này loại trừ trách nhiệm mà pháp luật bắt buộc không được phép loại trừ.</p>
        </section>

        <section id="changes" className={styles.section}>
          <h2>15. Thay đổi điều khoản</h2>
          <p>Chúng tôi có thể cập nhật các điều khoản khi tính năng, giá, nhà cung cấp, mô hình kinh doanh hoặc yêu cầu pháp lý thay đổi. Phiên bản cập nhật sẽ được công bố tại URL này cùng ngày hiệu lực hoặc ngày cập nhật.</p>
        </section>

        <section id="law" className={styles.section}>
          <h2>16. Luật áp dụng</h2>
          <p>Trong phạm vi phù hợp với hoạt động cung cấp dịch vụ và trừ khi pháp luật bắt buộc quy định khác, các điều khoản này được giải thích theo pháp luật Việt Nam. Các bên được khuyến khích ưu tiên trao đổi thiện chí để giải quyết tranh chấp trước khi sử dụng biện pháp pháp lý khác.</p>
        </section>

        <section id="contact" className={styles.section}>
          <h2>17. Liên hệ</h2>
          <p><span className={styles.strong}>Dịch vụ:</span> Mộc Tâm AI / Meta Chatbot</p>
          <p><span className={styles.strong}>Website:</span> <a className={styles.link} href="https://metachatbot.online">https://metachatbot.online</a></p>
          <p>Nếu có câu hỏi về Điều khoản dịch vụ, vui lòng sử dụng kênh hỗ trợ được công bố trên website hoặc trong tài khoản Mộc Tâm AI.</p>
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
