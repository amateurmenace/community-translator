document.addEventListener('DOMContentLoaded', function() {
    const runBtn = document.getElementById('runBtn');
    const analyzeBtn = document.getElementById('analyzeBtn');
    
    // Elements to watch
    const inputs = [
        document.getElementById('languageSelect'),
        document.getElementById('pageToggle'),
        document.getElementById('captionToggle'),
        document.getElementById('highlightToggle')
    ];

    // === KEYS ===
    const KEYS = {
        gemini: (typeof CONFIG !== 'undefined') ? CONFIG.GEMINI_KEY : '',
        translate: (typeof CONFIG !== 'undefined') ? CONFIG.TRANSLATE_KEY : ''
    };

    if (!KEYS.gemini || !KEYS.translate) alert("⚠️ Keys missing in config.js");

    function getSettings() {
        return {
            lang: document.getElementById('languageSelect').value,
            pageOn: document.getElementById('pageToggle').checked,
            captionOn: document.getElementById('captionToggle').checked,
            highlightOn: document.getElementById('highlightToggle').checked
        };
    }

    // Reset Button Logic
    inputs.forEach(el => {
        el.addEventListener('change', () => {
            runBtn.innerText = "Update / Run";
            runBtn.classList.remove('active');
            runBtn.style.opacity = "1";
        });
    });

    // === RUN MAIN BUTTON ===
    runBtn.addEventListener('click', () => {
        const settings = getSettings();
        runBtn.innerText = "Processing...";
        runBtn.style.opacity = "0.7";

        chrome.tabs.query({active: true, currentWindow: true}, (tabs) => {
            if(!tabs[0].url.startsWith('http')) return alert("Use on a real website.");
            
            chrome.scripting.executeScript({
                target: { tabId: tabs[0].id },
                function: runHybridEngine,
                args: [KEYS, settings, false] 
            }, () => {
                runBtn.innerText = "Active ✓";
                runBtn.classList.add('active');
                runBtn.style.opacity = "1";
            });
        });
    });

    // === RUN ANALYZE BUTTON ===
    analyzeBtn.addEventListener('click', () => {
        analyzeBtn.innerText = "⏳ Analyzing...";
        chrome.tabs.query({active: true, currentWindow: true}, (tabs) => {
            chrome.scripting.executeScript({
                target: { tabId: tabs[0].id },
                function: runHybridEngine,
                args: [KEYS, getSettings(), true] 
            }, () => {
                analyzeBtn.innerText = "✨ Analyze Page & Highlight";
            });
        });
    });
});


// ======================================================
// === HYBRID ENGINE (Runs inside webpage) ===
// ======================================================
async function runHybridEngine(apiKeys, settings, isAnalyze) {

    // --- 1. INJECT STYLES ---
    if (!document.getElementById('comm-css')) {
        const s = document.createElement('style');
        s.id = 'comm-css';
        s.textContent = `
            .comm-highlight { background-color: #ffeb3b; color: black; border-bottom: 2px solid #fbc02d; cursor: help; position: relative; }
            .comm-tooltip { 
                visibility: hidden; width: 240px; background-color: #12372A; color: #fff; text-align: left; 
                padding: 12px; border-radius: 8px; position: absolute; z-index: 10000; bottom: 130%; left: 50%; 
                transform: translateX(-50%) translateY(10px); opacity: 0; transition: all 0.3s;
                box-shadow: 0 10px 30px rgba(0,0,0,0.3); font-family: sans-serif; font-size: 13px; line-height: 1.4; pointer-events: none;
            }
            .comm-tooltip::after {
                content: ""; position: absolute; top: 100%; left: 50%; margin-left: -6px;
                border-width: 6px; border-style: solid; border-color: #12372A transparent transparent transparent;
            }
            .comm-highlight:hover .comm-tooltip { visibility: visible; opacity: 1; transform: translateX(-50%) translateY(0); }
            
            #comm-lookup { position: absolute; z-index: 2147483647; background: #12372A; color: white; padding: 15px; border-radius: 12px; box-shadow: 0 5px 30px rgba(0,0,0,0.4); max-width: 280px; font-family: sans-serif; font-size: 14px; }
            
            #comm-overlay { 
                position: fixed; bottom: 40px; left: 50%; transform: translateX(-50%); width: 700px; max-width: 90%; 
                background: rgba(18, 55, 42, 0.95); color: white; padding: 24px; border-radius: 16px; 
                z-index: 2147483647; text-align: center; font-family: sans-serif; font-size: 24px; 
                backdrop-filter: blur(8px); border: 1px solid rgba(255,255,255,0.1); 
                box-shadow: 0 10px 40px rgba(0,0,0,0.3); display: flex; flex-direction: column; gap: 5px;
            }
            #comm-indicator { font-size: 12px; color: #4ADE80; font-weight: 700; text-transform: uppercase; letter-spacing: 1px; margin-bottom: 5px; }
        `;
        document.head.appendChild(s);
    }

    // --- 2. API HELPERS ---
    
    // Cloud Translate (Fast/Bulk)
    async function translateText(textArray, targetLang) {
        try {
            const url = `https://translation.googleapis.com/language/translate/v2?key=${apiKeys.translate}`;
            const res = await fetch(url, {
                method: 'POST', headers: {'Content-Type': 'application/json'},
                body: JSON.stringify({ q: textArray, target: targetLang, format: 'text' })
            });
            const data = await res.json();
            return data.data.translations.map(t => t.translatedText);
        } catch(e) { return null; }
    }

    // Gemini (Smart/Simplify)
    async function askGemini(prompt) {
        try {
            const models = ['gemini-2.0-flash', 'gemini-1.5-flash', 'gemini-pro'];
            for (const model of models) {
                const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKeys.gemini}`;
                const res = await fetch(url, { method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify({ contents: [{ parts: [{ text: prompt }] }] }) });
                const data = await res.json();
                if(data.candidates) return data.candidates[0].content.parts[0].text;
            }
        } catch(e) { return null; }
    }

    // --- 3. FEATURE: ANALYZE PAGE ---
    if (isAnalyze) {
        document.querySelectorAll('.comm-highlight').forEach(el => el.outerHTML = el.innerText);
        const text = document.body.innerText.substring(0, 10000).replace(/\s+/g, ' ');
        const jsonStr = await askGemini(`Find 3 key insights. Return JSON: [{"text": "exact quote", "why": "explanation"}]. JSON ONLY. Text: ${text}`);
        
        if(jsonStr) {
            try {
                const insights = JSON.parse(jsonStr.replace(/```json/g, '').replace(/```/g, '').trim());
                const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT, null, false);
                const nodes = []; while(n = walker.nextNode()) nodes.push(n);

                insights.forEach(item => {
                    for(let node of nodes) {
                        if(node.nodeValue.includes(item.text)) {
                            const span = document.createElement('span');
                            span.className = 'comm-highlight';
                            span.textContent = item.text;
                            span.innerHTML += `<div class="comm-tooltip"><strong>✨ KEY INSIGHT</strong><br>${item.why}</div>`;
                            
                            const range = document.createRange();
                            range.setStart(node, node.nodeValue.indexOf(item.text));
                            range.setEnd(node, node.nodeValue.indexOf(item.text) + item.text.length);
                            range.deleteContents(); range.insertNode(span);
                            break; 
                        }
                    }
                });
                window.scrollTo(0,0);
            } catch(e) {}
        }
    }

    // --- 4. FEATURE: TRANSLATE/SIMPLIFY PAGE ---
    if (settings.pageOn && !isAnalyze) {
        document.body.style.borderLeft = "5px solid #12372A";
        
        // Collect Nodes
        const nodes = []; const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT, null, false);
        while(n = walker.nextNode()) {
            if(n.nodeValue.trim().length > 10 && !n.parentElement.closest('script, style, noscript')) nodes.push(n);
        }

        // Apply Styles
        function applyStyle(node) {
            if(node.parentElement) {
                node.parentElement.style.backgroundColor = "#E8F5E9"; 
                node.parentElement.style.borderRadius = "4px";
                node.parentElement.style.boxShadow = "0 0 0 3px #E8F5E9"; 
                node.parentElement.setAttribute("data-translated", "true");
            }
        }

        // MODE A: SIMPLIFY (Using Gemini - 9th Grade Level)
        if (settings.lang === 'Simple English') {
            const batch = nodes.slice(0, 30);
            const text = batch.map(n => n.nodeValue.replace(/\n/g, ' ')).join(" ||| ");
            
            // --- UPDATED PROMPT: 9th Grade Level ---
            const res = await askGemini(`Rewrite this text to be clear and readable at a 9th-grade level. Avoid jargon, but keep the meaning precise. Keep ||| separators. Text: ${text}`);
            
            if(res) {
                const parts = res.split('|||');
                batch.forEach((n, i) => { 
                    if(parts[i]) {
                        n.nodeValue = parts[i].trim();
                        applyStyle(n);
                    }
                });
            }
        } 
        // MODE B: TRANSLATE (Using Cloud API)
        else {
            const MAX_BATCH = 100;
            for(let i=0; i<nodes.length; i+=MAX_BATCH) {
                const chunk = nodes.slice(i, i+MAX_BATCH);
                const texts = chunk.map(n => n.nodeValue);
                const translations = await translateText(texts, settings.lang);
                if(translations) {
                    chunk.forEach((n, idx) => {
                        n.nodeValue = translations[idx];
                        applyStyle(n);
                    });
                }
            }
        }
    }

    // --- 5. FEATURE: LIVE CAPTIONS (FIXED) ---
    if (settings.captionOn && !isAnalyze) {
        if(!document.getElementById('comm-overlay')) {
            const d = document.createElement('div'); d.id = 'comm-overlay';
            d.innerHTML = `
                <div id="comm-indicator">Live Captions (${settings.lang})</div>
                <div id='comm-txt' style="min-height:30px;">Listening...</div>
            `;
            document.body.appendChild(d);
            
            const r = new webkitSpeechRecognition();
            r.continuous = true; r.interimResults = true; r.lang = 'en-US';
            
            r.onresult = async (e) => {
                const output = document.getElementById('comm-txt');
                let final = '';
                
                for (let i = e.resultIndex; i < e.results.length; ++i) {
                    if (e.results[i].isFinal) final += e.results[i][0].transcript;
                }

                if (final) {
                    output.style.opacity = "0.5"; 
                    
                    let resultText = "";
                    
                    // ROUTING: Simple English -> Gemini (9th Grade)
                    if (settings.lang === 'Simple English') {
                        const res = await askGemini(`Clarify this sentence for a 9th grader: "${final}"`);
                        resultText = res || final;
                    } else {
                        const res = await translateText([final], settings.lang);
                        resultText = res ? res[0] : final;
                    }

                    output.style.opacity = "1";
                    output.innerText = resultText;
                }
            };
            r.start();
        }
    }

    // --- 6. FEATURE: HIGHLIGHT LOOKUP ---
    if (settings.highlightOn && !isAnalyze) {
        document.onmouseup = async (e) => {
            const sel = window.getSelection().toString().trim();
            const old = document.getElementById('comm-lookup'); 
            if(old && old.contains(e.target)) return; 
            if(old) old.remove();

            if (sel.length > 0 && sel.length < 400) {
                const rect = window.getSelection().getRangeAt(0).getBoundingClientRect();
                const top = rect.bottom + window.scrollY + 10;
                const left = rect.left + window.scrollX;

                const pop = document.createElement('div'); 
                pop.id = 'comm-lookup';
                pop.style.top = top + 'px'; 
                pop.style.left = left + 'px';
                pop.innerHTML = "Thinking..."; 
                document.body.appendChild(pop);

                // Gemini Explanation (9th Grade style implied by 'simply')
                const ans = await askGemini(`Explain clearly in ${settings.lang} (max 30 words): "${sel}"`);
                
                pop.innerHTML = ans 
                    ? `<div style="color:#4ADE80; font-weight:bold; font-size:10px; margin-bottom:4px;">AI EXPLAINER</div>${ans}`
                    : "Could not analyze.";

                setTimeout(() => {
                    document.addEventListener('mousedown', function close(evt) {
                        if(!pop.contains(evt.target)) { pop.remove(); document.removeEventListener('mousedown', close); }
                    });
                }, 100);
            }
        };
    }
}