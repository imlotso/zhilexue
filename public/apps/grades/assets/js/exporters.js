/* ==========================================================
   导出能力：打印 / 导出图片(PNG) / 导出 PDF
   ========================================================== */
const Exporters = (() => {

  /** 打印指定节点（保留图表内容） */
  function printElement(el, title, sub) {
    if (!el) { window.print(); return; }
    const pa = document.getElementById('printArea');
    pa.innerHTML = '';
    const head = document.createElement('div');
    head.innerHTML = `<div class="print-title">${U.esc(title || '成绩报表')}</div>
      <div class="print-sub">${U.esc(sub || (Store.campusName() + '　导出时间：' + U.fmtDate(new Date())))}</div>`;
    pa.appendChild(head);

    const holder = document.createElement('div');
    const parent = el.parentNode, next = el.nextSibling;
    holder.appendChild(el);
    pa.appendChild(holder);
    document.body.classList.add('printing');

    const restore = () => {
      document.body.classList.remove('printing');
      if (next && next.parentNode === parent) parent.insertBefore(el, next);
      else parent.appendChild(el);
      pa.innerHTML = '';
      window.removeEventListener('afterprint', restore);
    };
    window.addEventListener('afterprint', restore);
    setTimeout(() => { window.print(); }, 60);
    setTimeout(() => { if (document.body.classList.contains('printing') && !window.matchMedia('print').matches) restore(); }, 3000);
  }

  /** 节点 → canvas */
  function toCanvas(el, scale = 2) {
    return html2canvas(el, {
      scale, backgroundColor: '#ffffff', useCORS: true, logging: false,
      windowWidth: el.scrollWidth, windowHeight: el.scrollHeight
    });
  }

  /** 导出图片 */
  async function exportImage(el, filename) {
    if (!el) return;
    U.toast('正在生成图片…');
    try {
      const canvas = await toCanvas(el, 2);
      canvas.toBlob(blob => {
        U.downloadBlob(blob, (filename || '成绩报表') + '.png');
        U.toast('图片已导出', 'ok');
      }, 'image/png');
    } catch (e) { console.error(e); U.toast('图片导出失败', 'err'); }
  }

  /** 导出 PDF（A4 纵向，超长自动分页；中文以图像方式呈现，保证字形正确） */
  async function exportPDF(el, filename, title) {
    if (!el) return;
    U.toast('正在生成 PDF…');
    try {
      const canvas = await toCanvas(el, 2);
      const { jsPDF } = window.jspdf;
      const pdf = new jsPDF({ orientation: 'portrait', unit: 'pt', format: 'a4' });
      const pw = pdf.internal.pageSize.getWidth();
      const ph = pdf.internal.pageSize.getHeight();
      const margin = 24;
      const cw = pw - margin * 2;
      const imgH = canvas.height * (cw / canvas.width);
      const pageH = ph - margin * 2;

      // 标题
      let y = 0;
      if (title) {
        pdf.setFont('helvetica', 'bold');
        pdf.setFontSize(11);
        pdf.text(title, margin, margin + 6);
        y = 14;
      }

      if (imgH <= pageH - y) {
        pdf.addImage(canvas.toDataURL('image/jpeg', 0.95), 'JPEG', margin, margin + y + 6, cw, imgH, undefined, 'FAST');
      } else {
        // 分页：按比例切片
        const slicePx = Math.floor((pageH - y - 6) / imgH * canvas.height);
        let offset = 0, page = 0;
        const tmp = document.createElement('canvas');
        const ctx = tmp.getContext('2d');
        tmp.width = canvas.width;
        while (offset < canvas.height) {
          const h = Math.min(slicePx, canvas.height - offset);
          tmp.height = h;
          ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, tmp.width, h);
          ctx.drawImage(canvas, 0, -offset);
          if (page > 0) pdf.addPage();
          const pageImgH = h * (cw / canvas.width);
          pdf.addImage(tmp.toDataURL('image/jpeg', 0.95), 'JPEG', margin, margin + (page === 0 ? y + 6 : 6), cw, pageImgH, undefined, 'FAST');
          offset += h; page++;
        }
      }
      pdf.save((filename || '成绩报表') + '.pdf');
      U.toast('PDF 已导出', 'ok');
    } catch (e) { console.error(e); U.toast('PDF 导出失败', 'err'); }
  }

  return { printElement, exportImage, exportPDF, toCanvas };
})();
