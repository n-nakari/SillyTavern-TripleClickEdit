import { eventSource, event_types } from '../../../../script.js';

let chatScrollBeforeEdit = null;
let editingMesId = null;

export async function init() {
    // 监听消息正文段落（<p> 标签）的点击事件
    $(document).on('click', '.mes_text p', function (e) {
        // e.detail 记录了连续点击的次数，3 表示三击
        if (e.detail === 3) {
            handleTripleClick(e, this);
        }
    });

    // 监听消息更新事件（当退出编辑模式，无论是点击 Save 还是 Cancel 都会触发）
    eventSource.on(event_types.MESSAGE_UPDATED, (mesId) => {
        // 如果当前更新的消息就是我们刚才三击触发编辑的消息
        if (editingMesId !== null && mesId === editingMesId) {
            if (chatScrollBeforeEdit !== null) {
                // 延迟 100ms 恢复滚动条，确保 ST 的 Markdown 渲染和 DOM 坍缩已经完全结束
                setTimeout(() => {
                    $('#chat').scrollTop(chatScrollBeforeEdit);
                    chatScrollBeforeEdit = null;
                    editingMesId = null;
                }, 100);
            }
        }
    });
}

/**
 * 处理三击事件的核心逻辑
 */
async function handleTripleClick(e, paragraphElement) {
    const $p = $(paragraphElement);
    const $mes = $p.closest('.mes');
    const mesId = parseInt($mes.attr('mesid'), 10);

    if (isNaN(mesId)) return;

    // 1. 记录进入编辑模式前，整个聊天界面的滚动条位置
    chatScrollBeforeEdit = $('#chat').scrollTop();
    editingMesId = mesId;

    // 获取被点击段落的纯文本内容，用于后续在 Markdown 源码中定位
    const pText = $p.text();

    // 2. 寻找当前消息的“编辑”按钮并触发点击
    const $editBtn = $mes.find('.mes_edit');
    if ($editBtn.length === 0) return;

    $editBtn.trigger('click');

    // 3. 轮询等待编辑框 (Textarea) 动态生成并挂载到 DOM
    let retries = 20;
    let $textarea = [];
    while (retries > 0) {
        await new Promise(r => setTimeout(r, 50));
        $textarea = $mes.find('textarea.edit_textarea');
        if ($textarea.length > 0) break;
        retries--;
    }

    if ($textarea.length === 0) return;

    // 4. 在 Markdown 源码中查找该段落的字符索引位置
    const markdownText = $textarea.val();
    const index = findTextIndexInMarkdown(pText, markdownText);

    if (index !== -1) {
        // 5. 计算高度并让聊天窗口滚动到对应段落
        scrollChatToTextareaIndex($textarea[0], index);
    }
}

/**
 * 在 Markdown 源码中模糊查找 HTML 文本的所在位置
 */
function findTextIndexInMarkdown(htmlText, markdownText) {
    // 移除非文字和非数字的字符（支持多语言，\p{L} 匹配所有字母/汉字/假名等，\p{N} 匹配数字）
    let searchText = htmlText.replace(/[^\p{L}\p{N}]/gu, '');
    
    // 提取段落开头最多 20 个有效字符作为特征字符串
    if (searchText.length > 20) searchText = searchText.substring(0, 20);
    // 如果段落太短，匹配极易出错，直接放弃定位
    if (searchText.length < 2) return -1;

    // 构建一个宽松的正则表达式，允许两个字之间存在任意数量的 Markdown 标记符号（如 * _ # > 等）
    let regexStr = searchText.split('').join('[^\\p{L}\\p{N}]*');
    
    try {
        let regex = new RegExp(regexStr, 'iu');
        let match = markdownText.match(regex);
        return match ? match.index : -1;
    } catch (err) {
        console.error("Triple-click edit regex parse error:", err);
        return -1;
    }
}

/**
 * 根据找到的字符串索引，将主聊天视口（#chat）滚动到编辑框中该行出现的位置
 */
function scrollChatToTextareaIndex(textarea, index) {
    // 将光标焦点设置到目标位置
    textarea.focus();
    textarea.setSelectionRange(index, index);

    // 计算目标字符在第几行（通过统计前面的换行符数量）
    const textBefore = textarea.value.substring(0, index);
    const linesBefore = textBefore.split('\n').length;

    // 获取 textarea 实际渲染的行高
    const computedStyle = window.getComputedStyle(textarea);
    let lineHeight = parseInt(computedStyle.lineHeight, 10);
    if (isNaN(lineHeight)) {
        // 如果 line-height 为 'normal'，使用字体大小的 1.2 倍作为近似值
        lineHeight = parseInt(computedStyle.fontSize, 10) * 1.2 || 20;
    }

    // 计算该行文字相对于 textarea 顶部的像素偏移量
    const lineOffsetY = Math.max(0, (linesBefore - 1) * lineHeight);

    const $chat = $('#chat');
    const $textarea = $(textarea);

    // 计算 textarea 的顶部相对于当前 #chat 滚动视口顶部的绝对 Y 坐标
    const chatOffsetTop = $chat.offset().top;
    const textareaOffsetTop = $textarea.offset().top;
    const currentChatScroll = $chat.scrollTop();

    const absoluteTextareaTop = currentChatScroll + (textareaOffsetTop - chatOffsetTop);

    // 目标滚动位置：textarea 的绝对顶端 + 行偏移 - 顶部留白（留出 80px 使得目标段落不要紧贴屏幕边缘）
    const targetScroll = absoluteTextareaTop + lineOffsetY - 80;

    // 将外部聊天容器平滑或瞬间切至目标位置
    $chat.scrollTop(targetScroll);
}
