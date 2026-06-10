import { eventSource, event_types } from "../../../../script.js";

let savedScrollPosition = 0;
let isTripleClickEditing = false;

/**
 * 将 Textarea 滚动到指定的字符串索引位置（置顶显示）
 * 使用镜像 Div 技术精确计算文字渲染后的高度
 */
function scrollToIndexInTextarea(textarea, index) {
    const mirror = document.createElement('div');
    const style = window.getComputedStyle(textarea);

    // 复制所有影响文字排版的样式到隐藏的镜像 Div 中
    const properties = [
        'boxSizing', 'width', 'fontFamily', 'fontSize', 'fontWeight',
        'fontStyle', 'letterSpacing', 'lineHeight', 'textDecoration',
        'textIndent', 'textTransform', 'whiteSpace', 'wordBreak',
        'wordSpacing', 'wordWrap', 'paddingTop', 'paddingRight',
        'paddingBottom', 'paddingLeft', 'borderTopWidth', 'borderRightWidth',
        'borderBottomWidth', 'borderLeftWidth'
    ];

    properties.forEach(prop => {
        mirror.style[prop] = style[prop];
    });

    // 设置镜像 Div 为隐藏且绝对定位
    mirror.style.position = 'absolute';
    mirror.style.visibility = 'hidden';
    mirror.style.overflow = 'hidden';
    mirror.style.left = '-9999px';
    mirror.style.top = '0';
    mirror.style.whiteSpace = 'pre-wrap';
    mirror.style.wordWrap = 'break-word';

    // 截取从开头到目标索引的文本
    const textUpToIndex = textarea.value.substring(0, index);

    // 转换换行符并插入一个追踪位置的锚点 span
    mirror.innerHTML = textUpToIndex.replace(/\n/g, '<br>') + '<span id="caret-marker">|</span>';

    document.body.appendChild(mirror);

    // 获取锚点相对于顶部的像素高度
    const marker = mirror.querySelector('#caret-marker');
    const targetTop = marker.offsetTop;

    document.body.removeChild(mirror);

    // 将编辑框的滚动条精确设定到计算出的高度
    textarea.scrollTop = targetTop;

    // 将光标设置在目标段落的开头，并聚焦
    textarea.setSelectionRange(index, index);
    textarea.focus();
}

/**
 * 触发进入编辑模式并自动定位
 */
async function initiateEdit(pElement) {
    const $mes = $(pElement).closest('.mes');
    const mesId = $mes.attr('mesid');

    if (!mesId) return;

    // 提取点击段落的纯文本
    const pText = $(pElement).text().trim();

    // ==========================================
    // 保存原始聊天窗口滚动位置
    // ==========================================
    savedScrollPosition = $('#chat').scrollTop();
    isTripleClickEditing = true;

    // 模拟点击自带的“编辑”按钮进入编辑模式
    $mes.find('.mes_edit').trigger('click');

    // ==========================================
    // 修复问题1：使用 requestAnimationFrame 极速轮询
    // 在捕获到输入框的第一瞬间将其透明度设为 0
    // ==========================================
    let $textarea = null;
    await new Promise((resolve) => {
        let attempts = 0;
        function checkElement() {
            $textarea = $('#curEditTextarea');
            if ($textarea.length > 0 && $textarea.val().length > 0) {
                // 瞬间捕获，隐藏编辑框以避免置底卡顿和闪烁
                $textarea.css('opacity', '0');
                resolve();
            } else if (attempts < 60) { // 大约1秒钟的超时安全退出
                attempts++;
                requestAnimationFrame(checkElement);
            } else {
                resolve();
            }
        }
        requestAnimationFrame(checkElement);
    });

    if (!$textarea || $textarea.length === 0) {
        isTripleClickEditing = false;
        return;
    }

    const rawText = $textarea.val();
    let targetIndex = 0;

    // 构建一个允许穿透 HTML 注释 (如 <!-- draft -->) 及 Markdown 符号的正则表达式
    // 取该段落的前 10 个单词作为锚点
    const words = pText.split(/\s+/).slice(0, 10).map(w => w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
    
    if (words.length > 0) {
        // [\s\S]*? 允许匹配两个单词之间的任意字符（如空格、星号、HTML标签、注释等）
        const regexStr = words.join('[\\s\\S]*?');
        const matchRegex = new RegExp(regexStr, 'i');
        const match = rawText.match(matchRegex);

        if (match) {
            targetIndex = match.index;
        } else {
            // 如果极度复杂的结构导致正则失效，退回到基础的 index 匹配
            targetIndex = rawText.indexOf(words.join(' '));
            if (targetIndex === -1) targetIndex = 0; 
        }
    }

    // 执行精准滚动与定位
    scrollToIndexInTextarea($textarea[0], targetIndex);

    // ==========================================
    // 修复问题2：打断浏览器为了居中光标而强制执行的滚动
    // 在一切计算并定位完毕后，立刻恢复#chat容器原本的位置，最后再恢复透明度可见
    // ==========================================
    $('#chat').scrollTop(savedScrollPosition);
    $textarea.css('opacity', '1');
}

// 插件入口初始化
jQuery(function() {
    
    // 利用原生 e.detail === 3 监听三击事件
    $('#chat').on('click', '.mes_text p', function(e) {
        if (e.detail === 3) {
            e.preventDefault();
            // 确保没有选中多余的文本干扰视线，同时打断可能触发原生ST逻辑的干扰
            window.getSelection().removeAllRanges(); 
            initiateEdit(this);
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
