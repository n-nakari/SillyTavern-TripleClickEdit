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
function initiateEdit(pElement) {
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

    // 采用 requestAnimationFrame 实现极速轮询，捕捉生成的编辑框，消除等待延迟
    let attempts = 0;
    const findAndScroll = () => {
        const $textarea = $('#curEditTextarea');
        
        if ($textarea.length > 0 && $textarea.val().length > 0) {
            // 找到编辑框后，立刻将其透明度设为 0，防止在最底部时发生视觉闪烁跳转
            $textarea.css('opacity', '0');
            
            const rawText = $textarea.val();
            let targetIndex = 0;

            // 提取前 15 个非空白字符（使用 Array.from 完美处理 Emoji 和 中文字符）
            const chars = Array.from(pText.replace(/\s+/g, '')).slice(0, 15);
            
            if (chars.length > 0) {
                // 转义正则特殊字符
                const escapedChars = chars.map(c => c.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
                
                // 核心修复：严苛拼接正则
                // 允许字符之间存在“最多 20 个的空白符、Markdown 符号或 HTML 标签”
                // 这样既能穿透段落内部的 **加粗** 格式，又绝对跨不过像 <!-- consider: ... --> 这种带有普通文字的注释块
                const regexStr = escapedChars.join('(?:\\s|[*_~`="\']|<[^>]+>){0,20}?');
                const matchRegex = new RegExp(regexStr, 'i');
                const match = rawText.match(matchRegex);

                if (match) {
                    targetIndex = match.index;
                } else {
                    // Fallback: 如果依然没有匹配到，退回到非常基础的字符串查找
                    targetIndex = rawText.indexOf(pText.substring(0, 10));
                    if (targetIndex === -1) targetIndex = 0; 
                }
            }

            // 执行精准滚动
            scrollToIndexInTextarea($textarea[0], targetIndex);
            
            // 滚动完成后，恢复文本框可见度（瞬间完成，无视觉卡顿）
            $textarea.css('opacity', '1');
            
        } else if (attempts < 60) { 
            // 最多尝试约 1 秒 (60帧)
            attempts++;
            requestAnimationFrame(findAndScroll);
        }
    };
    
    requestAnimationFrame(findAndScroll);
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
    // 监听消息更新以恢复位置
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
