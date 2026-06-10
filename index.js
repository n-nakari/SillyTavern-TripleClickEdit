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

            // 1. 保存当前滚动位置
            savedScrollPosition = $('#chat').scrollTop();
            isTripleClickEditing = true;

            // 2. 提取所点击段落的核心词汇，用于在Markdown源码中进行模糊定位
            // 去除所有标点符号，只保留字母、数字和空白字符（支持中文）
            const textToFind = $p.text().trim();
            const cleanText = textToFind.replace(/[^\p{L}\p{N}\s]/gu, '');
            // 取出前8个具有代表性的词汇/字
            const searchWords = cleanText.split(/\s+/).filter(w => w.length > 0).slice(0, 8);

            // 3. 触发SillyTavern内置的编辑功能
            $editBtn.trigger('click');

            try {
                // 4. 等待编辑用的 textarea 渲染完成
                const textarea = await waitForElement('#curEditTextarea');
                const $textarea = $(textarea);
                
                // 使用 setInterval 确保 textarea 已被 ST 赋值，消除 fixed timeout 导致的执行时机问题
                const checkReady = setInterval(() => {
                    const rawText = textarea.value;
                    if (rawText.length > 0) {
                        clearInterval(checkReady);
                        let matchIndex = 0;

                        // 5. 在包含Markdown、<!-- draft -->等复杂语法的原文中寻找目标段落
                        if (searchWords.length > 0) {
                            // 构建正则：允许单词之间插入0到150个任意字符（兼容复杂的内联标签、注释等）
                            const regexStr = searchWords.map(escapeRegExp).join('[\\s\\S]{0,150}?');
                            const regex = new RegExp(regexStr, 'i');
                            const match = rawText.match(regex);
                            
                            if (match) {
                                matchIndex = match.index;
                            }
                        }

                        // 6. 将光标设置到该段落开头，并利用原生的 focus() 让浏览器瞬间定位，避免先去底部再回弹
                        textarea.setSelectionRange(matchIndex, matchIndex);
                        textarea.blur(); // 丢失焦点打断ST的默认定位
                        textarea.focus(); // 重新聚焦，迫使浏览器立刻滚动到我们设置的光标所在位置

                        // 7. 计算相对位置比例并瞬间滚动视口 (去除 animate 动画以防止视觉滑动残影)
                        const proportion = matchIndex / rawText.length;
                        
                        // 判断textarea是否有内置滚动条（高度被限制），还是被ST完全撑开了高度
                        if (textarea.scrollHeight > textarea.clientHeight + 20) {
                            // 文本域自身出现滚动条的情况
                            const targetScroll = textarea.scrollHeight * proportion;
                            $textarea.scrollTop(targetScroll - 50); // 留出一点顶部边距
                            
                            // 保证textarea本身在屏幕可视范围内
                            const offset = $textarea.offset().top - $('#chat').offset().top;
                            $('#chat').scrollTop($('#chat').scrollTop() + offset - 50);
                        } else {
                            // 文本域被完全撑开的情况 (SillyTavern的 field-sizing: content 特性)
                            const textareaY = $textarea.offset().top - $('#chat').offset().top;
                            // 计算目标段落在页面中的绝对位置
                            const targetY = textareaY + ($textarea.height() * proportion);
                            
                            $('#chat').scrollTop($('#chat').scrollTop() + targetY - 100);
                        }
                    }
                }, 10);

            } catch (err) {
                console.error("Triple-click edit plugin error:", err);
                isTripleClickEditing = false;
            }
        }
    });

    // 8. 监听SillyTavern更新消息事件（点击Save、Cancel或者按Esc退出编辑都会触发）
    eventSource.on(event_types.MESSAGE_UPDATED, () => {
        if (isTripleClickEditing) {
            isTripleClickEditing = false;
            
            // 修复：同步立即恢复滚动位置，拦截浏览器将视图重置到消息顶部的默认行为
            $('#chat').scrollTop(savedScrollPosition);
            
            // 修复：使用 requestAnimationFrame 在浏览器下一次重绘前再次确认位置，确保退出极度平滑无闪烁
            requestAnimationFrame(() => {
                $('#chat').scrollTop(savedScrollPosition);
            });
        }
    });
});
