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
    // 核心修复：无视正则魔改的“骨架穿透”匹配算法
    // ==========================================
    
    // 1. 过滤掉所有标点、引号、空格等，仅提取纯字母、数字和中日韩字符作为骨架
    const cleanChars = pText.replace(/[^\p{L}\p{N}]/gu, '').split('');
    
    if (cleanChars.length > 0) {
        // 2. 取前 15 个纯字符作为锚点（既有唯一性，计算也不会过慢）
        const searchChars = cleanChars.slice(0, 15);
        
        // 3. 构建正则：允许任意两个骨架字符间插有 0-150 个任意字符。
        // 这意味着不管你是删减了词语（八股正则）、转换了引号（引号正则）、还是中间卡了奇怪的标签，全都能穿透匹配
        const regexStr = searchChars.map(c => c.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('[\\s\\S]{0,150}?');
        const matchRegex = new RegExp(regexStr, 'i');
        const match = rawText.match(matchRegex);

        if (match) {
            targetIndex = match.index;
            
            // 4. 向上追溯回卷：识别并涵盖附着在段落前面的长串隐藏标签
            const textBefore = rawText.substring(0, targetIndex);
            
            // 如果我们匹配字符时不小心匹配到了 <!-- draft: [生成原稿] 阿遥... --> 的内部
            // 退回到注释块开头
            const lastOpenComment = textBefore.lastIndexOf('<!--');
            const lastCloseComment = textBefore.lastIndexOf('-->');
            if (lastOpenComment > lastCloseComment) {
                targetIndex = lastOpenComment; 
            }
            
            // 继续检查定位点前面是不是还紧挨着其他的标签簇 (找寻段间 \n\n )
            const doubleNewline = rawText.lastIndexOf('\n\n', targetIndex);
            if (doubleNewline !== -1) {
                const gap = rawText.substring(doubleNewline + 2, targetIndex);
                // 把尖括号标签和注释干掉之后，看看这块空白带里是不是没有别的内容了
                const gapWithoutTags = gap.replace(/<[^>]+>/g, '').replace(/<!--[\s\S]*?-->/g, '').trim();
                // 如果空隙里全都是隐藏标签（比如<DH_..>或<!--count..-->），直接退回到段间空白处
                if (gapWithoutTags === '') {
                    targetIndex = doubleNewline + 2;
                }
            }
            
        } else {
            // 如果被魔改得连 15 个字符骨架都匹配不齐，降级到 5 个字符试试
            const fallbackChars = cleanChars.slice(0, 5);
            if (fallbackChars.length > 0) {
                const fallbackRegexStr = fallbackChars.map(c => c.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('[\\s\\S]{0,150}?');
                const fallbackMatch = rawText.match(new RegExp(fallbackRegexStr, 'i'));
                if (fallbackMatch) targetIndex = fallbackMatch.index;
            }
        }
    }

    // 执行精准滚动
    scrollToIndexInTextarea($textarea[0], targetIndex);

    // 计算并滚动到正确位置后，恢复可见，丝滑无缝
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
