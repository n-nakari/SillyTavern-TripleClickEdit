import { eventSource, event_types } from "../../../../script.js";

jQuery(async function () {
    let savedScrollPosition = 0;
    let isTripleClickEditing = false;

    // 辅助函数：等待DOM元素出现
    function waitForElement(selector, timeout = 3000) {
        return new Promise((resolve, reject) => {
            if (document.querySelector(selector)) {
                return resolve(document.querySelector(selector));
            }
            const observer = new MutationObserver((mutations) => {
                if (document.querySelector(selector)) {
                    observer.disconnect();
                    resolve(document.querySelector(selector));
                }
            });
            observer.observe(document.body, { childList: true, subtree: true });
            setTimeout(() => {
                observer.disconnect();
                reject(new Error(`Timeout waiting for ${selector}`));
            }, timeout);
        });
    }

    // 辅助函数：转义正则特殊字符
    function escapeRegExp(string) {
        return string.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    }

    // 监听聊天框内段落的点击事件
    $('#chat').on('click', '.mes_text p', async function (e) {
        // 判断是否为连续三次点击
        if (e.originalEvent.detail === 3) {
            e.preventDefault();
            
            const $p = $(this);
            const $mes = $p.closest('.mes');
            const $editBtn = $mes.find('.mes_edit');
            
            if ($editBtn.length === 0) return; // 如果没有编辑按钮，说明不可编辑

            // 1. 保存进入编辑前最原始的全局滚动位置
            savedScrollPosition = $('#chat').scrollTop();
            isTripleClickEditing = true;

            // 获取点击的 <p> 距离当前文本框顶部 (.mes_text) 的物理像素差
            // 这是解决“跳转不到对应段落”最精确的方法，因为进入编辑模式后，textarea会精确取代.mes_text的位置
            const $mesText = $mes.find('.mes_text');
            const relativeP_Top = $p.offset().top - $mesText.offset().top;

            // 2. 提取所点击段落的核心词汇，用于在Markdown源码中精确定位光标
            const textToFind = $p.text().trim();
            const cleanText = textToFind.replace(/[^\p{L}\p{N}\s]/gu, '');
            const searchWords = cleanText.split(/\s+/).filter(w => w.length > 0).slice(0, 8);

            // 3. 锁定滚动，解决进入编辑框时页面瞬间向上卡顿偏移的跳动问题
            // 原生ST逻辑会将光标移动到文本末尾导致浏览器强制滚动，我们在这里暴力拦截它
            let blockScroll = true;
            const chatEl = document.getElementById('chat');
            const scrollLockHandler = () => {
                if (blockScroll) chatEl.scrollTop = savedScrollPosition;
            };
            chatEl.addEventListener('scroll', scrollLockHandler);

            // 触发SillyTavern内置的编辑功能
            $editBtn.trigger('click');

            try {
                // 4. 等待编辑用的 textarea 渲染完成
                const textarea = await waitForElement('#curEditTextarea');
                const $textarea = $(textarea);
                
                const checkReady = setInterval(() => {
                    const rawText = textarea.value;
                    // 确保 textarea 已被赋值，并且高度已经被 ST 完全撑开展开
                    if (rawText.length > 0 && textarea.scrollHeight > 20) {
                        clearInterval(checkReady);
                        let matchIndex = 0;

                        // 5. 在源码中寻找目标段落并获取在源码中的索引值
                        if (searchWords.length > 0) {
                            const regexStr = searchWords.map(escapeRegExp).join('[\\s\\S]{0,150}?');
                            const regex = new RegExp(regexStr, 'i');
                            const match = rawText.match(regex);
                            if (match) {
                                matchIndex = match.index;
                            }
                        }

                        // 释放滚动拦截
                        blockScroll = false;
                        chatEl.removeEventListener('scroll', scrollLockHandler);

                        // 6. 重新设置光标位置。使用 preventScroll: true 完美防止浏览器再次发生原生视口跳转现象
                        textarea.setSelectionRange(matchIndex, matchIndex);
                        textarea.focus({ preventScroll: true });

                        // 7. 核心修复：根据之前点击的 <p> 的物理相对高度，精确滚动到对应的可视区域
                        // textarea的当前Y坐标 + 原来 <p> 的相对Y坐标 - 顶部留白(40px，确保完整可读)
                        const textareaTop = $textarea.offset().top - $('#chat').offset().top + $('#chat').scrollTop();
                        const targetScrollTop = textareaTop + relativeP_Top - 40;
                        
                        $('#chat').scrollTop(targetScrollTop);
                    }
                }, 10);

            } catch (err) {
                console.error("Triple-click edit plugin error:", err);
                isTripleClickEditing = false;
                blockScroll = false;
                document.getElementById('chat').removeEventListener('scroll', scrollLockHandler);
            }
        }
    });

    // 8. 监听SillyTavern更新消息事件（点击Save、Cancel或者按Esc退出编辑都会触发）
    eventSource.on(event_types.MESSAGE_UPDATED, () => {
        if (isTripleClickEditing) {
            isTripleClickEditing = false;
            
            // 恢复进入编辑模式前精准的滚动位置
            $('#chat').scrollTop(savedScrollPosition);
            
            // 确保渲染重绘完成后滚动位置依然稳固，无视觉跳跃感
            requestAnimationFrame(() => {
                $('#chat').scrollTop(savedScrollPosition);
            });
        }
    });
});
