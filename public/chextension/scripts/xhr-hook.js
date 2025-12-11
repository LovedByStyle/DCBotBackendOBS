// XHR Hook - Runs in page context (MAIN world)
// This script intercepts all XMLHttpRequest calls and processes slot responses directly

(function() {
    // Listen for deadline date from content script
    window.addEventListener('message', (event) => {
        if (event.data.type === 'DVSA_SET_DEADLINE') {
            window.deadlineDate = event.data.deadlineDate;
            console.log('📅 Deadline date received in MAIN world:', window.deadlineDate);
        }
    });

    const originalOpen = XMLHttpRequest.prototype.open;
    const originalSend = XMLHttpRequest.prototype.send;

    XMLHttpRequest.prototype.open = function(method, url) {
        this._url = url;
        this._method = method;
        return originalOpen.apply(this, arguments);
    };

    XMLHttpRequest.prototype.send = function() {
        const xhr = this;

        this.addEventListener('readystatechange', function() {
            if (xhr.readyState === 4 && xhr.status === 200) {
                const url = xhr._url || '';

                // 🎯 FILTER: Only process Next/Previous Available requests
                if (url.includes('searchForWeeklySlotsNextAvailable') ||
                    url.includes('searchForWeeklySlotsPreviousAvailable')) {
                    // Process immediately in MAIN world (faster!)
                    processSlotResponse(xhr.responseText, url);
                }
            }
        });

        return originalSend.apply(this, arguments);
    };

    // Process slot response - ULTRA FAST!
    function processSlotResponse(htmlText, url) {
        try {
            // ============================================
            // PRIORITY 1: CHECK FOR SLOTS FIRST!
            // ============================================
            const lastPos = htmlText.lastIndexOf('searchForDaySlots');

            if (lastPos !== -1) {
                // SLOT FOUND! Process immediately!
                let hrefStart = htmlText.lastIndexOf('href="', lastPos) + 6;
                let hrefEnd = htmlText.indexOf('"', lastPos);
                let lastSlotLink = htmlText.substring(hrefStart, hrefEnd).replace(/&amp;/g, '&');

                // Extract period date
                const periodStart = htmlText.indexOf('Number of available tests between');
                const ndashPos = htmlText.indexOf('&ndash;', periodStart);
                const dateText = htmlText.substring(periodStart + 33, ndashPos).trim();

                const year = dateText.substring(dateText.length - 4);
                const day = dateText[0] === '1' ? dateText.substring(0, 2) : dateText[0];
                const firstGT = dateText.indexOf('>');
                const lastLT = dateText.lastIndexOf('<');
                const month = dateText.substring(firstGT + 1, lastLT);
                const periodStartDate = new Date(`${month} ${day} ${year}`);

                // Check if within deadline date
                const deadlineDate = window.deadlineDate ? new Date(window.deadlineDate) : new Date();

                if (periodStartDate > deadlineDate) {
                    return; // Outside target range
                }

                // Send slot immediately!
                window.postMessage({
                    type: 'DVSA_SLOT_FOUND',
                    slotLink: lastSlotLink
                }, '*');
                return;
            }

            // ============================================
            // PRIORITY 2: NO SLOTS - CHECK FOR ERRORS
            // ============================================
            // Rate limit check
            if (htmlText.includes('Pardon Our Interruption')) {
                window.postMessage({ type: 'DVSA_RATE_LIMIT' }, '*');
                return;
            }

            // Incapsula errors check
            if (htmlText.includes('_Incapsula_Resource')) {
                if (htmlText.includes('edet=15')) {
                    window.postMessage({ type: 'DVSA_ERROR15' }, '*');
                    return;
                }
                if (htmlText.includes('edet=12')) {
                    window.postMessage({ type: 'DVSA_CAPTCHA' }, '*');
                    return;
                }
                window.postMessage({ type: 'DVSA_CAPTCHA' }, '*');
                return;
            }

        } catch (error) {
            console.error('❌ ERROR in processSlotResponse:', error);
            console.error('   URL:', url);
            console.error('   Stack:', error.stack);
        }
    }

    console.log('✅ XHR hooks installed successfully');
})();
