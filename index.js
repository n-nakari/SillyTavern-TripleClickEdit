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

    // 【修复问题2】：转义 HTML 特殊字符
    // 防止 <!-- draft --> 或 <tag> 在 innerHTML 中被当做真实注释/标签解析而“失去高度”
    const escapeHtml = (text) => text
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;');
        
    const safeText = escapeHtml(textUpToIndex).replace(/\n/g, '<br>');

    // 插入转义后的安全文本与一个追踪位置的锚点 span
    mirror.innerHTML = safeText + '<span id="caret-marker">|</span>';

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
    // 注入用户提供的代码：保存原始聊天窗口滚动位置
    // ==========================================
    savedScrollPosition = $('#chat').scrollTop();
    isTripleClickEditing = true;

    // 模拟点击自带的“编辑”按钮进入编辑模式
    $mes.find('.mes_edit').trigger('click');

    // 【修复问题1】：使用 requestAnimationFrame 极速轮询，并在第一瞬间将透明度设为 0
    let $textarea = null;
    await new Promise((resolve) => {
        const startTime = Date.now();
        function checkTextarea() {
            $textarea = $('#curEditTextarea');
            // 确保 textarea 存在且已经填充了内容
            if ($textarea.length > 0 && $textarea.val().length > 0) {
                $textarea.css('opacity', '0'); // 第一瞬间隐形，消除默认置底的闪烁
                resolve();
            } else if (Date.now() - startTime > 1000) {
                resolve(); // 1秒超时保护
            } else {
                requestAnimationFrame(checkTextarea);
            }
        }
        requestAnimationFrame(checkTextarea);
    });

    if (!$textarea || $textarea.length === 0) return;

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
            
            // 【针对问题2的额外优化】：如果匹配到的文本前面紧挨着 <!-- ... --> 隐藏标签块
            // 我们将光标与定位点进一步提前到注释的开头，确保你能完整看到它们，而不需要往上滚
            const textBefore = rawText.substring(0, targetIndex);
            const lastCommentEnd = textBefore.lastIndexOf('-->');
            if (lastCommentEnd !== -1) {
                // 检查 --> 到正文之间是否只有空白字符或换行
                const spaceBetween = textBefore.substring(lastCommentEnd + 3);
                if (/^\s*$/.test(spaceBetween)) {
                    const lastCommentStart = textBefore.lastIndexOf('<!--');
                    if (lastCommentStart !== -1) {
                        targetIndex = lastCommentStart; // 追溯定位到注释最顶端
                    }
                }
            }
        } else {
            // 如果极度复杂的结构导致正则失效，退回到基础的 index 匹配
            targetIndex = rawText.indexOf(words.join(' '));
            if (targetIndex === -1) targetIndex = 0; 
        }
    }

    // 执行精准滚动
    scrollToIndexInTextarea($textarea[0], targetIndex);

    // 【修复问题1】：高度计算与滚动完毕后，恢复文本框显示，实现无缝切换
    $textarea.css('opacity', '1');
}

// 插件入口初始化
jQuery(function() {
    
    // 利用原生 e.detail === 3 监听三击事件
    $('#chat').on('click', '.mes_text p', function(e) {
        if (e.detail === 3) {
            e.preventDefault();
            // 确保没有选中多余的文本干扰视线
            window.getSelection().removeAllRanges(); 
            initiateEdit(this);
        }
    });

    // ==========================================
    // 注入用户提供的代码：监听消息更新以恢复位置
    // ==========================================
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
