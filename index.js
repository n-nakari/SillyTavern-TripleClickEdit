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
    // 全新精准文本映射算法：应对正则删改、标签隐藏及 Draft 重复
    // ==========================================
    
    // 1. 将 <!-- --> 替换为等长空格。这不仅保护了 Index 索引位置不变，还能彻底防止匹配到隐藏的原稿(draft)中
    const sanitizedRawText = rawText.replace(/<!--[\s\S]*?-->/g, match => ' '.repeat(match.length));

    // 2. 提取段落中的特征字符（去除了所有的标点符号、空格、各种类型的引号），最多取 20 个字
    const pureChars = pText.replace(/[^\p{L}\p{N}]/gu, '');
    const anchorChars = pureChars.slice(0, 20).split('');

    if (anchorChars.length > 0) {
        // 允许每个可见字之间有最多 400 个字符的干扰间隙（足够跨过被正则删掉的长标签和大量废话词汇）
        const regexStr = anchorChars.join('[\\s\\S]{0,400}?');
        const matchRegex = new RegExp(regexStr, 'i');
        
        // 3. 计算前面所有兄弟元素的渲染文本总长度，作为锚点估算我们在全文中的位置
        const precedingTextLength = $(pElement).prevAll().text().length;
        // 留出 1500 字符的巨大容错空间，防止上文因为正则产生大范围文本缩减而导致索引偏移
        const searchStartIndex = Math.max(0, precedingTextLength - 1500);

        // 4. 从安全位置开始正则搜索
        const match = sanitizedRawText.substring(searchStartIndex).match(matchRegex);

        if (match) {
            targetIndex = searchStartIndex + match.index;
        } else {
            // 如果带起始位置没搜到（极其罕见的极端全文本大修），退回到从头全局搜索
            const globalMatch = sanitizedRawText.match(matchRegex);
            if (globalMatch) {
                targetIndex = globalMatch.index;
            } else {
                targetIndex = 0; 
            }
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
