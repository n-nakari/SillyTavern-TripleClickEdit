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
    // 注入用户提供的代码：保存原始聊天窗口滚动位置
    // ==========================================
    savedScrollPosition = $('#chat').scrollTop();
    isTripleClickEditing = true;

    // 模拟点击自带的“编辑”按钮进入编辑模式
    $mes.find('.mes_edit').trigger('click');

    // 使用 requestAnimationFrame 极速轮询等待 Textarea 渲染
    let $textarea = null;
    let attempts = 0;
    
    await new Promise((resolve) => {
        function checkTextarea() {
            $textarea = $('#curEditTextarea');
            if ($textarea.length > 0) {
                // 捕获到输入框的第一瞬间将其透明度设为 0，防止底部跳转闪烁
                $textarea.css('opacity', '0');
                
                // 确保值已填充
                if ($textarea.val().length > 0) {
                    return resolve();
                }
            }
            
            attempts++;
            if (attempts > 60) { // 大约等待 1 秒 (60 帧)，防止死循环
                return resolve();
            }
            requestAnimationFrame(checkTextarea);
        }
        requestAnimationFrame(checkTextarea);
    });

    if (!$textarea || $textarea.length === 0 || $textarea.val().length === 0) {
        if ($textarea && $textarea.length > 0) $textarea.css('opacity', '1');
        return;
    }

    const rawText = $textarea.val();
    let targetIndex = 0;

    // ==========================================
    // 全新高容错定位算法：免疫标点替换与正则删词
    // ==========================================
    
    // 1. 提取点击段落的前 15 个“纯文字/数字”（完全过滤标点、符号、空格）
    // 这样就彻底无视了引号被替换为「」等标点变更的干扰
    const cleanChars = pText.replace(/[^\p{L}\p{N}]/gu, '').split('').slice(0, 15);
    
    if (cleanChars.length > 0) {
        // 2. 将这 15 个字用间隔正则缝合。[\s\S]{0,500}? 表示两个字之间允许存在最多500个任意字符（包括换行、隐藏标签、被删减的词等）
        const regexStr = cleanChars.join('[\\s\\S]{0,500}?');
        const matchRegex = new RegExp(regexStr, 'iu'); 
        const match = rawText.match(matchRegex);

        if (match) {
            targetIndex = match.index;
            
            // 3. 向上回溯：如果正文第一个字的上方紧挨着 <!-- draft --> 等隐藏标签，将定位点上移包含标签
            const textBefore = rawText.substring(0, targetIndex);
            // 匹配紧跟在段落前的任意 HTML 标签、注释及空白符
            const leadingTagsRegex = /(?:<[^>]+>|<!--[\s\S]*?-->|\s)+$/i;
            const tagMatch = textBefore.match(leadingTagsRegex);
            
            if (tagMatch) {
                targetIndex -= tagMatch[0].length;
            }
        } else {
            // 极度异常的情况退回到基础匹配
            targetIndex = rawText.indexOf(pText.substring(0, 5));
            if (targetIndex === -1) targetIndex = 0; 
        }
    }

    // 执行精准滚动
    scrollToIndexInTextarea($textarea[0], targetIndex);

    // 计算并滚动到正确位置后，恢复可见
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
