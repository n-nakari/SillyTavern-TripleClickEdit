import { eventSource, event_types } from "../../../../script.js";

jQuery(async function () {
    let savedScrollPosition = 0;
    let isTripleClickEditing = false;

    // 辅助函数：转义正则特殊字符
    function escapeRegExp(string) {
        return string.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    }

    // 监听聊天框内段落的点击事件
    $('#chat').on('click', '.mes_text p', function (e) {
        // 判断是否为连续三次点击
        if (e.originalEvent.detail === 3) {
            e.preventDefault();
            
            const $p = $(this);
            const $mes = $p.closest('.mes');
            const $editBtn = $mes.find('.mes_edit');
            
            if ($editBtn.length === 0) return; // 如果没有编辑按钮，说明不可编辑

            // 1. 记录退出编辑时需要恢复的原始位置
            savedScrollPosition = $('#chat').scrollTop();
            isTripleClickEditing = true;

            // 2. 提取所点击段落的核心词汇，用于在Markdown源码中进行模糊定位
            const textToFind = $p.text().trim();
            const cleanText = textToFind.replace(/[^\p{L}\p{N}\s]/gu, '');
            const searchWords = cleanText.split(/\s+/).filter(w => w.length > 0).slice(0, 8);

            // 3. 计算目标段落的物理Y坐标（解决 Issue 2：基于绝对像素位移替代内部滚动比例）
            const chatTop = $('#chat').offset().top;
            const pTop = $p.offset().top;
            // 计算段落相对于 #chat 内容顶部的绝对 Y 坐标（减去60px作为顶部缓冲，使其更居中/易读）
            let targetScrollY = savedScrollPosition + (pTop - chatTop) - 60; 
            
            // 确保目标滚动位置不越界（确保完整的 textarea 在可视范围内合理显示）
            const maxScroll = $('#chat')[0].scrollHeight - $('#chat')[0].clientHeight;
            targetScrollY = Math.max(0, Math.min(targetScrollY, maxScroll));

            // 4. 触发SillyTavern内置的编辑功能
            $editBtn.trigger('click');

            // 5. 使用 requestAnimationFrame 帧锁定（解决 Issue 1：拦截并覆盖ST默认的光标跳底和滚动行为，消除闪烁）
            let frameCount = 0;
            let textSet = false;

            const fixScrollAndCursor = () => {
                frameCount++;
                
                // 强制锁定滚动条，无视ST底层发出的跳转指令
                $('#chat').scrollTop(targetScrollY);

                const textarea = document.getElementById('curEditTextarea');
                if (textarea && textarea.value.length > 0 && !textSet) {
                    textSet = true;
                    let matchIndex = 0;

                    if (searchWords.length > 0) {
                        // 构建正则：允许单词之间插入0到150个任意字符（兼容复杂的内联标签、注释等情况）
                        const regexStr = searchWords.map(escapeRegExp).join('[\\s\\S]{0,150}?');
                        const regex = new RegExp(regexStr, 'i');
                        const match = textarea.value.match(regex);
                        if (match) {
                            matchIndex = match.index;
                        }
                    }

                    // 准确将光标强制拉回我们点击的段落开头，覆盖掉 ST 默认设置到末尾的行为
                    textarea.setSelectionRange(matchIndex, matchIndex);
                    textarea.focus();
                }

                // 持续锁定视图 15 帧（约 250ms），确保 ST 内部所有的 DOM 异步操作和 focus 事件都已结束，防止视觉跳动
                if (frameCount < 15) {
                    requestAnimationFrame(fixScrollAndCursor);
                }
            };
            
            requestAnimationFrame(fixScrollAndCursor);
        }
    });

    // 6. 监听SillyTavern更新消息事件（点击Save、Cancel或者按Esc退出编辑都会触发）
    eventSource.on(event_types.MESSAGE_UPDATED, () => {
        if (isTripleClickEditing) {
            isTripleClickEditing = false;
            
            // 退出编辑时无缝恢复到刚开始编辑前的原始位置
            let frameCount = 0;
            const restoreScroll = () => {
                frameCount++;
                $('#chat').scrollTop(savedScrollPosition);
                
                if (frameCount < 5) {
                    requestAnimationFrame(restoreScroll);
                }
            };
            requestAnimationFrame(restoreScroll);
        }
    });
});
