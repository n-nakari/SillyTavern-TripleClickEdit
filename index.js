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

    mirror.style.position = 'absolute';
    mirror.style.visibility = 'hidden';
    mirror.style.overflow = 'hidden';
    mirror.style.left = '-9999px';
    mirror.style.top = '0';
    mirror.style.whiteSpace = 'pre-wrap';
    mirror.style.wordWrap = 'break-word';

    // 截取从开头到目标索引的文本
    const textUpToIndex = textarea.value.substring(0, index);

    // 【关键修复】必须转义 HTML，因为 Textarea 视标签为纯文本，镜像 Div 也必须按纯文本渲染，否则 <!-- draft --> 不占高度
    const escapeHtml = (t) => t.replace(/[&<>"']/g, m => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#039;' })[m]);

    // 转换换行符并插入一个追踪位置的锚点 span
    mirror.innerHTML = escapeHtml(textUpToIndex).replace(/\n/g, '<br>') + '<span id="caret-marker">|</span>';

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
 * 智能模糊匹配算法：在原始文本中寻找对应的段落索引
 * 忽略 HTML 注释、标签，且无视标点符号和正则造成的增删改查
 */
function findBestMatchIndex(rawText, pText) {
    // 1. 将 HTML 注释和标签遮罩为空格，保持长度不变，从而避免匹配到草稿 (draft) 等隐藏内容
    let masked = rawText.replace(/<!--[\s\S]*?-->/g, match => ' '.repeat(match.length));
    masked = masked.replace(/<[^>]+>/g, match => ' '.repeat(match.length));

    // 2. 提取所有的核心字符（字母、数字、中日韩文字），过滤掉标点符号和空格
    const coreRegex = /[\p{L}\p{N}]/u;
    const rawMap = [];
    for (let i = 0; i < masked.length; i++) {
        if (coreRegex.test(masked[i])) {
            rawMap.push({ char: masked[i], index: i });
        }
    }

    let pChars = "";
    for (let i = 0; i < pText.length; i++) {
        if (coreRegex.test(pText[i])) {
            pChars += pText[i];
        }
    }

    if (pChars.length === 0) return 0;

    // 取前 40 个核心字符作为特征搜索目标
    const N = Math.min(pChars.length, 40);
    const searchTarget = pChars.substring(0, N);

    let bestMatchRawIndex = -1;
    let maxMatches = -1;
    let minSpan = Infinity;

    // 3. 滑动窗口寻找最佳匹配
    for (let i = 0; i < rawMap.length; i++) {
        // 如果当前字符在搜索目标的前几位中没有出现，直接跳过以加速
        // (放宽到 15 位是为了兼容某些给段落强行注入前缀的极端正则)
        let startIdx = searchTarget.indexOf(rawMap[i].char);
        if (startIdx === -1 || startIdx > 15) continue;

        let pIdx = startIdx;
        let matches = 0;
        let rawIdx = i;
        
        // 贪心匹配，允许 rawText 或 pText 存在最高 30 个字的正则增删误差
        while (pIdx < N && rawIdx < rawMap.length && (rawIdx - i) < N + 30) {
            if (rawMap[rawIdx].char === searchTarget[pIdx]) {
                matches++;
                pIdx++;
                rawIdx++;
            } else {
                let nextRawMatches = (rawIdx + 1 < rawMap.length && rawMap[rawIdx+1].char === searchTarget[pIdx]);
                let nextPMatches = (pIdx + 1 < N && rawMap[rawIdx].char === searchTarget[pIdx+1]);
                
                if (nextRawMatches && !nextPMatches) {
                    rawIdx++; // 原始文本多了字 (被正则删了)
                } else if (nextPMatches && !nextRawMatches) {
                    pIdx++;   // 页面文本多了字 (被正则加了)
                } else {
                    rawIdx++;
                    pIdx++;
                }
            }
        }
        
        // 记录最佳匹配点
        if (matches > maxMatches || (matches === maxMatches && (rawIdx - i) < minSpan)) {
            maxMatches = matches;
            minSpan = rawIdx - i;
            bestMatchRawIndex = rawMap[i].index;
        }
    }

    // 如果匹配率低于 30%，说明没找到，兜底返回 0 (顶部)
    if (maxMatches < N * 0.3) {
        return 0;
    }

    return bestMatchRawIndex;
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

    try {
        const rawText = $textarea.val();
        
        // 调用智能模糊搜索
        const targetIndex = findBestMatchIndex(rawText, pText);
        
        // 执行精准滚动
        scrollToIndexInTextarea($textarea[0], targetIndex);
    } finally {
        // 计算并滚动到正确位置后，无论是否成功，恢复可见
        $textarea.css('opacity', '1');
    }
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
