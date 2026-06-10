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

    // 使用 requestAnimationFrame 极速轮询等待 Textarea 渲染
    return new Promise((resolve) => {
        let attempts = 0;
        const maxAttempts = 60; // 约 1 秒 (60 帧)，防止死循环

        function checkTextarea() {
            const $textarea = $('#curEditTextarea');
            
            if ($textarea.length > 0) {
                // 第一瞬间将透明度设为 0，阻断一切跳转与置底闪烁！
                if ($textarea.css('opacity') !== '0') {
                    $textarea.css('opacity', '0');
                }

                if ($textarea.val().length > 0) {
                    const rawText = $textarea.val();
                    let targetIndex = 0;

                    // ====== 核心改进：生成忽略多行注释的安全搜索副本 ======
                    // 将所有的 <!-- ... --> 以及可能写错的 <--! ... --> 替换为等长度的空格
                    // 这样就能确保匹配出的 index 完全正确，且绝不会匹配进隐藏段落里
                    const searchableText = rawText.replace(/<(?:!--|--!)[\s\S]*?-->/g, match => ' '.repeat(match.length));

                    // 取段落里前 15 个非空字符作为搜索锚点（无视中英文分词规律）
                    const chars = pText.replace(/\s+/g, '').substring(0, 15).split('');
                    
                    if (chars.length > 0) {
                        // 构建宽容正则：每个字中间最多允许20个无关字符（包容 Markdown 星号、排版等干扰）
                        const regexStr = chars.map(c => c.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('[\\s\\S]{0,20}?');
                        const matchRegex = new RegExp(regexStr, 'i');

                        // 在“屏蔽了注释”的安全文本中搜索，直击正文
                        const match = searchableText.match(matchRegex);

                        if (match) {
                            targetIndex = match.index;
                        } else {
                            // 终极备用方案：寻找前10个字的纯文本死配
                            targetIndex = searchableText.indexOf(pText.substring(0, 10));
                            if (targetIndex === -1) targetIndex = 0; 
                        }
                    }

                    // 执行精准滚动
                    scrollToIndexInTextarea($textarea[0], targetIndex);
                    
                    // 计算和滚动完成，恢复编辑框的可见度
                    $textarea.css('opacity', '1');
                    return resolve();
                }
            }

            attempts++;
            if (attempts < maxAttempts) {
                requestAnimationFrame(checkTextarea);
            } else {
                // 保底超时处理，恢复可见性
                if ($textarea.length > 0) $textarea.css('opacity', '1');
                resolve();
            }
        }

        requestAnimationFrame(checkTextarea);
    });
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
    // 监听SillyTavern更新消息事件以恢复位置
    // ==========================================
    // （点击Save、Cancel或者按Esc退出编辑都会触发）
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
