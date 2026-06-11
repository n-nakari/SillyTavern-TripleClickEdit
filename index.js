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

    // -----------------------------------------------------------
    // 全新修复：模糊字符序列对齐算法，忽略被隐藏的标签和被正则修改的内容
    // -----------------------------------------------------------
    
    // 1. 将 rawText 中的隐藏标签和注释替换为空格，保持原本的字符索引位置不变
    // 这样可以彻底无视 <!-- draft --> 和 <xxx> 标签，防止错误定位到它们内部
    let searchableText = rawText.replace(/<!--[\s\S]*?-->/g, match => ' '.repeat(match.length));
    searchableText = searchableText.replace(/<[^>]*>/g, match => ' '.repeat(match.length));

    // 2. 提取所点击段落里的前 20 个纯字符（仅字母、数字、中日韩文字），过滤掉标点和引号等容易被正则替换的符号
    const pureChars = pText.match(/[\p{L}\p{N}]/gu) || [];
    
    if (pureChars.length > 0) {
        const anchorChars = pureChars.slice(0, 20);
        let bestIndex = 0;
        let maxMatched = -1;

        // 3. 在 searchableText 中扫描，寻找和 anchorChars 匹配度最高的字符序列
        for (let i = 0; i < searchableText.length; i++) {
            // 匹配起始字必须一致
            if (searchableText[i] !== anchorChars[0]) continue;

            let matchCount = 1;
            let ptr = i + 1;
            
            // 顺序匹配后续锚点字
            for (let j = 1; j < anchorChars.length; j++) {
                let foundIndex = -1;
                // 向下寻找匹配字符，容错跨度设为 150 字符，容忍此期间被正则删去或替换的短语
                let limit = Math.min(ptr + 150, searchableText.length); 
                for (let k = ptr; k < limit; k++) {
                    if (searchableText[k] === anchorChars[j]) {
                        foundIndex = k;
                        break;
                    }
                }
                
                // 如果在容忍范围内找到了，匹配度加一，并将扫描指针移到该字之后
                if (foundIndex !== -1) {
                    matchCount++;
                    ptr = foundIndex + 1;
                }
            }

            // 记录最高匹配分数的索引作为最终位置
            if (matchCount > maxMatched) {
                maxMatched = matchCount;
                bestIndex = i;
                
                // 若达到了 100% 满分匹配，这就是最完美的答案，立刻中断扫描节省性能
                if (matchCount === anchorChars.length) {
                    break;
                }
            }
        }
        targetIndex = bestIndex;
    }

    // -----------------------------------------------------------

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
