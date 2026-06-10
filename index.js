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
    
    // 核心改进：获取文本域内指定文字位置的精准Y轴像素坐标
    function getCaretY(textarea, position) {
        const div = document.createElement('div');
        const style = window.getComputedStyle(textarea);
        
        // 复制影响文本排版的所有关键CSS样式
        const props = [
            'fontFamily', 'fontSize', 'fontWeight', 'lineHeight', 
            'paddingTop', 'paddingRight', 'paddingBottom', 'paddingLeft', 
            'borderTopWidth', 'borderRightWidth', 'borderBottomWidth', 'borderLeftWidth', 
            'boxSizing', 'letterSpacing', 'textAlign', 'textIndent', 'textTransform',
            'whiteSpace', 'wordBreak', 'wordWrap'
        ];
        props.forEach(p => div.style[p] = style[p]);
        
        div.style.position = 'absolute';
        div.style.visibility = 'hidden';
        // 精确对齐文本域自身宽度
        div.style.width = textarea.getBoundingClientRect().width + 'px';
        
        // 填入目标位置前的所有文本
        div.textContent = textarea.value.substring(0, position);
        const span = document.createElement('span');
        // 加入目标字符以获取高度（如果是最后一位，用点号代替进行定位）
        span.textContent = textarea.value.substring(position, position + 1) || '.';
        div.appendChild(span);
        
        document.body.appendChild(div);
        const y = span.offsetTop;
        document.body.removeChild(div);
        
        return y;
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
            const textToFind = $p.text().trim();
            // 去除所有标点符号，只保留字母、数字和汉字等空白字符
            const cleanText = textToFind.replace(/[^\p{L}\p{N}\s]/gu, '');
            const searchWords = cleanText.split(/\s+/).filter(w => w.length > 0).slice(0, 8);

            // 构建用于匹配的正则字符串
            let regexStr = '';
            if (searchWords.length > 0) {
                regexStr = searchWords.map(escapeRegExp).join('[\\s\\S]{0,150}?');
            } else {
                // 回退方案：应对只有标点符号、特殊Markdown标签没有文字的情况
                const rawChars = textToFind.replace(/\s+/g, '').slice(0, 5);
                if (rawChars.length > 0) {
                    regexStr = escapeRegExp(rawChars).split('').join('[\\s\\S]{0,50}?');
                }
            }

            // 3. 触发SillyTavern内置的编辑功能
            $editBtn.trigger('click');

            try {
                // 4. 等待编辑用的 textarea 渲染完成
                const textarea = await waitForElement('#curEditTextarea');
                const $textarea = $(textarea);
                
                // 使用 setInterval 确保 textarea 已被 ST 正确赋值
                const checkReady = setInterval(() => {
                    const rawText = textarea.value;
                    if (rawText.length > 0) {
                        clearInterval(checkReady);
                        
                        // 延迟 50ms：让 ST 自带的光标沉底 (setSelectionRange) 以及附带的滚动复位执行完毕，防止我们的定位被冲刷
                        setTimeout(() => {
                            let matchIndex = 0;

                            // 5. 在包含Markdown、<!-- draft -->等复杂语法的原文中寻找目标段落
                            if (regexStr) {
                                const regex = new RegExp(regexStr, 'i');
                                const match = rawText.match(regex);
                                if (match) {
                                    matchIndex = match.index;
                                }
                            }

                            // 6. 将光标设置到目标位置
                            textarea.setSelectionRange(matchIndex, matchIndex);
                            textarea.focus();

                            // 7. 计算光标在文本域内的精准 Y 轴像素偏移量
                            const caretY = getCaretY(textarea, matchIndex);
                            
                            // 8. 计算绝对滚动高度：文本域距离 Chat 顶部的距离 + 光标在文本域内的位置 - 顶部留白(50px可视空间)
                            const $chat = $('#chat');
                            const textareaTop = $textarea.offset().top - $chat.offset().top + $chat.scrollTop();
                            const targetScroll = textareaTop + caretY - 50; 
                            
                            $chat.scrollTop(targetScroll);
                        }, 50);
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
            
            // 同步恢复滚动位置
            $('#chat').scrollTop(savedScrollPosition);
            
            // 使用 requestAnimationFrame 在浏览器下一次重绘前再次确认位置，确保退出极度平滑无闪烁
            requestAnimationFrame(() => {
                $('#chat').scrollTop(savedScrollPosition);
            });
        }
    });
});
