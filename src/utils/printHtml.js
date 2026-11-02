// Prints an HTML document through a hidden iframe.
// With Chrome started as `chrome --kiosk-printing` this goes straight to the default
// printer without Chrome's own print dialog. Resolves once printing has been handed off.
export const printHtml = (html) => new Promise((resolve) => {
    const iframe = document.createElement('iframe');
    iframe.style.position = 'fixed';
    iframe.style.width = '0';
    iframe.style.height = '0';
    iframe.style.border = '0';
    iframe.style.visibility = 'hidden';
    document.body.appendChild(iframe);

    const iframeDoc = iframe.contentWindow.document;
    iframeDoc.open();
    iframeDoc.write(html);
    iframeDoc.close();

    let finished = false;
    const finish = () => {
        if (finished) return;
        finished = true;
        // Give the print spooler a moment before removing the document it is printing
        setTimeout(() => {
            if (iframe.parentNode) document.body.removeChild(iframe);
            resolve();
        }, 500);
    };

    iframe.contentWindow.onafterprint = finish;
    iframe.contentWindow.focus();
    iframe.contentWindow.print();
    // print() blocks in Chrome until done; fallback for browsers that return at once
    setTimeout(finish, 3000);
});
