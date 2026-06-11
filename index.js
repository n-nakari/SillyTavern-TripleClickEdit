import { eventSource, event_types } from "../../../../script.js";

let savedScrollPosition = 0;
let isTripleClickEditing = false;

/**
 * 模糊匹配算法：在 rawText 中寻找与 pText 最匹配的段落起始索引。
 * 能穿透 <!-- draft --> 等 HTML 注释，以及无视正则引起的字词删减和标点替换。
 */
function findBestMatchIndex(rawText, pText) {
    // 1. 建立映射字符串，忽略掉可能被隐藏的 HTML 注释和标签，避免误匹配到 draft 等隐藏块里
    let mappedStr = '';
    let map = []; // map[mapped_index] = raw_index
    
    let i = 0;
    while (i < rawText.length) {
        if (rawText.substring(i, i + 4) === '<!--') {
            let end = rawText.indexOf('-->', i);
            if (end !== -1) {
                i = end + 3;
                continue;
            }
        }
        // 跳过短的 <...> 标签 (如 <DH_xxx>)，以防干扰。如果找不到 > 或者太长，就不当成标签
        if (rawText[i] === '<') {
            let end = rawText.indexOf('>', i);
            if (end !== -1 && end - i < 100 && !rawText.substring(i, end).includes('\n')) {
                i = end + 1;
                continue;
            }
        }

        mappedStr += rawText[i];
        map.push(i);
        i++;
    }

    // 2. 提取 pText 的前 N 个有效字符（汉字、字母、数字）作为搜索指纹
    const validRegex = /[\u4e00-\u9fa5a-zA-Z0-9]/;
    const pValidChars = [];
    for (const c of pText) {
        if (validRegex.test(c)) pValidChars.push(c);
        if (pValidChars.length >= 40) break; // 取前40个字符，足够精确定位
    }

    if (pValidChars.length === 0) return 0;

    // 3. 在 mappedStr 中寻找最佳起点
    let bestIndex = 0;
    let maxScore = -1;

    for (let j = 0; j < mappedStr.length; j++) {
        if (!validRegex.test(mappedStr[j])) continue;
        // 起点必须匹配 pText 的前三个有效字符之一（容错：如果第一个字被删了，还能匹配第二个）
        if (mappedStr[j] !== pValidChars[0] && mappedStr[j] !== pValidChars[1] && mappedStr[j] !== pValidChars[2]) {
            continue;
        }

        let score = 0;
        let mPtr = j;
        let pPtr = 0;
        let misses = 0;

        // 向后探路匹配 (容错机制)
        while (mPtr < mappedStr.length && pPtr < pValidChars.length && misses < 15) {
            if (validRegex.test(mappedStr[mPtr])) {
                if (mappedStr[mPtr] === pValidChars[pPtr]) {
                    score++;
                    pPtr++;
                } else {
                    // 字符不同时，可能是被替换或被删减
                    // 在 pValidChars 中向后找找看
                    let found = false;
                    for (let look = 1; look <= 5; look++) {
                        if (pPtr + look < pValidChars.length && mappedStr[mPtr] === pValidChars[pPtr + look]) {
                            pPtr += look;
                            score++;
                            found = true;
                            break;
                        }
                    }
                    if (!found) {
                        misses++;
                    }
                }
            }
            mPtr++;
        }

        // 奖励靠近段落开头的匹配：如果 j 之前是换行符，增加权重
        let isLineStart = false;
        for (let back = j - 1; back >= 0; back--) {
            if (mappedStr[back] === '\n') {
                isLineStart = true;
                break;
            }
            if (validRegex.test(mappedStr[back])) {
                break;
            }
        }

        let finalScore = score + (isLineStart ? 10 : 0);

        if (finalScore > maxScore) {
            maxScore = finalScore;
            bestIndex = j;
        }
    }

    // 4. 将 mappedStr 的索引还原为 rawText 的真实的原始索引
    if (maxScore < 5) return 0; // 如果文本彻底面目全非，回退到顶部

    let rawIndex = map[bestIndex];

    // 为了美观，我们稍微把光标往前移，跨过空白和标点，但绝不越过换行和隐藏标签
    while (rawIndex > 0 && rawText[rawIndex - 1] !== '\n') {
        if (rawText.substring(rawIndex - 3, rawIndex) === '-->') break;
        if (rawText[rawIndex - 1] === '>') break; 
        if (validRegex.test(rawText[rawIndex - 1])) break; // 不要越过前面的其他有效文字
        rawIndex--;
    }

    return rawIndex;
}

/**
 * 将 Textarea 滚动到指定的字符串索引位置（置顶显示）
 * 使用镜像 Div 技术精确计算文字渲染后的高度
 */
function scrollToIndexInTextarea(textarea, index) {
    const mirror = document.createElement('div');
    const style = window.getComputedStyle(textarea);

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

    const textUpToIndex = textarea.value.substring(0, index);
    mirror.innerHTML = textUpToIndex.replace(/\n/g, '<br>') + '<span id="caret-marker">|</span>';

    document.body.appendChild(mirror);
    const marker = mirror.querySelector('#caret-marker');
    const targetTop = marker.offsetTop;
    document.body.removeChild(mirror);

    textarea.scrollTop = targetTop;
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

    // 保存滚动位置
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
                if ($textarea.val().length > 0) {
                    return resolve();
                }
            }
            
            attempts++;
            // 兜底机制：最多等待约 1 秒 (60 帧)
            if (attempts > 60) {
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
    
    // 调用改良后的模糊匹配算法
    const targetIndex = findBestMatchIndex(rawText, pText);

    // 精准对齐并解除透明隐藏
    scrollToIndexInTextarea($textarea[0], targetIndex);
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
