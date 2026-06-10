import { getContext } from "../../../../script.js";

function init() {
    const chatContainer = document.getElementById('chat');

    // 监听聊天容器的点击事件
    chatContainer.addEventListener('click', async (e) => {
        // e.detail 记录了连续点击的次数，3 即为三击
        if (e.detail === 3) {
            // 确保点击的是消息正文内的段落 (包含 p, div 或 span 防兼容)
            const clickedParagraph = e.target.closest('.mes_text p, .mes_text div, .mes_text span');
            if (!clickedParagraph) return;

            // 寻找包含该段落的整个消息块
            const messageBlock = clickedParagraph.closest('.mes');
            if (!messageBlock) return;

            // 寻找该消息块自带的编辑按钮
            const editBtn = messageBlock.querySelector('.mes_edit');
            if (!editBtn) return;

            // 阻止浏览器默认的三击全选文本行为（提升视觉体验）
            e.preventDefault();

            // 执行核心逻辑
            await handleTripleClickEdit(messageBlock, clickedParagraph, editBtn, chatContainer);
        }
    });
}

async function handleTripleClickEdit(mes, p, editBtn, chatContainer) {
    // 1. 【核心】记录进入编辑模式前，聊天视口的精确滚动位置
    const originalScrollTop = chatContainer.scrollTop;

    // 2. 提取点击段落的前几个单词，用于稍后在 Markdown 源码中进行模糊定位
    // 取前 6 个单词，过滤掉所有非字母数字字符（规避 Markdown 语法如 *, _, # 的干扰）
    const words = p.textContent.trim().split(/\s+/).slice(0, 6).join(' ');
    const strippedWords = words.replace(/[^a-zA-Z0-9\u4e00-\u9fa5]/g, ''); // 兼容中文

    // 3. 模拟点击进入编辑模式
    editBtn.click();

    // 4. 等待 SillyTavern 生成并渲染 textarea
    let textarea = null;
    for (let i = 0; i < 20; i++) {
        await new Promise(r => setTimeout(r, 10)); // 每 10ms 检查一次
        textarea = mes.querySelector('textarea');
        if (textarea) break;
    }

    if (!textarea) return; // 如果未能生成 textarea，安全退出

    // 5. 在原始 Markdown 文本中计算点击段落的字符偏移量
    const rawText = textarea.value;
    let charOffset = 0;

    if (strippedWords.length > 0) {
        // 构建模糊匹配正则：允许字符之间存在任意标点或 Markdown 符号
        const fuzzyRegexStr = strippedWords.split('').join('[^a-zA-Z0-9\u4e00-\u9fa5]*');
        try {
            const match = rawText.match(new RegExp(fuzzyRegexStr, 'i'));
            if (match) {
                charOffset = match.index;
            }
        } catch (err) {
            console.warn("TripleClickEdit: 正则匹配失败", err);
        }
    }

    // 6. 将 Textarea 精确滚动到目标文本位置（使其置顶）
    if (charOffset > 0) {
        // 【魔法技巧】创建一个隐藏的克隆 textarea，填入 charOffset 之前的文本
        // 利用浏览器的 scrollHeight 来精确计算由于自动折行带来的实际像素高度
        const clone = document.createElement('textarea');
        clone.style.cssText = window.getComputedStyle(textarea).cssText;
        clone.style.height = '1px';
        clone.style.visibility = 'hidden';
        clone.style.position = 'absolute';
        clone.style.overflow = 'hidden';
        clone.value = rawText.substring(0, charOffset);
        document.body.appendChild(clone);

        // 获取精确高度
        const targetScrollTop = clone.scrollHeight;
        document.body.removeChild(clone);

        // 将光标定位过去，并将编辑框滚动条设置为刚才计算的高度
        textarea.focus();
        textarea.setSelectionRange(charOffset, charOffset);
        // 减去 padding，确保段落严丝合缝贴在编辑框顶部
        const paddingTop = parseInt(window.getComputedStyle(textarea).paddingTop || 0);
        textarea.scrollTop = targetScrollTop - paddingTop;
    }

    // 7. 【核心】拦截退出动作，强制锁死聊天页面的滚动条
    // 获取刚刚生成的 保存(Confirm) 和 取消(Cancel) 按钮
    const saveBtn = mes.querySelector('.mes_edit_done');
    const cancelBtn = mes.querySelector('.mes_edit_cancel');

    const enforceScroll = () => {
        // ST 在退出编辑时会有 DOM 重绘和默认的回到底部/顶部逻辑
        // 我们在接下来的 500 毫秒内，高频强行锁死 `scrollTop`，对抗 ST 的原生跳动
        const start = Date.now();
        const scrollLocker = setInterval(() => {
            chatContainer.scrollTop = originalScrollTop;
            if (Date.now() - start > 500) {
                clearInterval(scrollLocker);
            }
        }, 10); // 每 10 毫秒强制复位一次
    };

    // 绑定只执行一次的监听器
    if (saveBtn) saveBtn.addEventListener('click', enforceScroll, { once: true });
    if (cancelBtn) cancelBtn.addEventListener('click', enforceScroll, { once: true });
}

// 采用 SillyTavern 标准的入口方法
jQuery(function () {
    init();
});
