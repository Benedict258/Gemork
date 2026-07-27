const SlackAdapter = (() => {
  function readPage(doc) {
    const result = { type: 'unknown', content: {} };

    const channelHeader = doc.querySelector('.p-channel_header__title, [data-qa="channel_name"], .c-channel_header__title');
    if (channelHeader) {
      result.content.channel = channelHeader.textContent.trim();
      result.type = 'channel';
    }

    if (result.type === 'unknown') {
      const dmHeader = doc.querySelector('.p-channel_header__title--im, [data-qa="dm_channel_name"]');
      if (dmHeader) {
        result.content.channel = dmHeader.textContent.trim();
        result.type = 'dm';
      }
    }

    const messages = doc.querySelectorAll('.c-message, [data-qa="message"], .p-message_pane_message');
    if (messages.length > 0) {
      result.content.messages = Array.from(messages).map(msg => {
        const authorEl = msg.querySelector('.c-message__sender_button, .c-message__sender, [data-qa="message_sender"]');
        const textEl = msg.querySelector('.c-message__body, .c-message_kit_text, [data-qa="message_text"]');
        const timestampEl = msg.querySelector('.c-message__sender_link time') || msg.querySelector('.c-timestamp');
        const reactions = Array.from(msg.querySelectorAll('.c-reaction, [data-qa="reaction"]')).map(r => ({
          emoji: r.querySelector('.c-reaction_emoji, [data-qa="reaction_emoji"]')?.textContent?.trim() || '',
          count: parseInt(r.querySelector('.c-reaction_count, [data-qa="reaction_count"]')?.textContent?.trim() || '0'),
        }));
        const threadReplies = msg.querySelector('.c-message__reply_count, [data-qa="reply_count"]')?.textContent?.trim() || '';
        return {
          author: authorEl?.textContent?.trim() || '',
          text: textEl?.textContent?.trim()?.slice(0, 2000) || '',
          timestamp: timestampEl?.getAttribute?.('datetime') || timestampEl?.textContent?.trim() || '',
          reactions,
          threadReplies,
        };
      }).filter(m => m.text || m.author);
    }

    const threadPanel = doc.querySelector('.p-threads_panel, [data-qa="thread_panel"], .c-thread_parent_message');
    if (threadPanel) {
      const parentMsg = threadPanel.querySelector('.c-message, [data-qa="message"]');
      result.content.thread = {
        parentMessage: parentMsg ? {
          author: parentMsg.querySelector('.c-message__sender, [data-qa="message_sender"]')?.textContent?.trim() || '',
          text: parentMsg.querySelector('.c-message__body, [data-qa="message_text"]')?.textContent?.trim()?.slice(0, 2000) || '',
        } : null,
        replyCount: threadPanel.querySelector('.c-thread_reply_count, [data-qa="reply_count"]')?.textContent?.trim() || '',
      };
      result.type = 'thread';
    }

    const sidebar = doc.querySelector('.p-ia__sidebar, .p-workspace__sidebar, [data-qa="sidebar"]');
    if (sidebar) {
      const channels = sidebar.querySelectorAll('[data-qa="channel_item"], .p-channel_sidebar__channel, .c-channel_list_item');
      result.content.channels = Array.from(channels).map(ch => ({
        name: ch.querySelector('.c-channel_list_item__name, [data-qa="channel_name"]')?.textContent?.trim() || '',
        active: ch.classList.contains('p-channel_sidebar__channel--selected'),
        unread: ch.querySelector('.c-channel_list_item__badge, [data-qa="badge"]')?.textContent?.trim() || '',
      })).filter(ch => ch.name);
    }

    const composer = doc.querySelector('.c-text_input_input, [data-qa="message_input"], .p-message_input__input, [role="textbox"]');
    if (composer) {
      result.content.composer = {
        placeholder: composer.getAttribute('placeholder') || composer.getAttribute('data-placeholder') || '',
        channel: result.content.channel || '',
      };
    }

    const bookmarkBar = doc.querySelector('.p-bookmarks_bar, [data-qa="bookmarks"]');
    if (bookmarkBar) {
      result.content.bookmarks = Array.from(bookmarkBar.querySelectorAll('a, button')).map(b => ({
        text: b.textContent.trim().slice(0, 100),
        href: b.href || '',
      }));
    }

    result.content.text = doc.body ? doc.body.innerText.slice(0, 50000) : '';
    return result;
  }

  function getInteractiveElements(doc) {
    const counter = { value: 1 };
    const selectors = [
      '.c-text_input_input',
      '[data-qa="message_input"]',
      '.p-message_input__input',
      '[role="textbox"]',
      '.c-message',
      '[data-qa="message"]',
      '.c-reaction',
      '[data-qa="reaction"]',
      '.c-message__sender_button',
      '[data-qa="message_sender"]',
      'button[aria-label*="emoji"]',
      '[data-qa="bookmark_link"]',
      '.p-channel_sidebar__channel',
      '[data-qa="channel_item"]',
      'a[href*="/archives/"]',
      'a[href*="/messages/"]',
      '.c-button, button',
    ];
    const elements = doc.querySelectorAll(selectors.join(','));
    return Array.from(elements).map(el => {
      const id = counter.value++;
      el._gemorkRefId = id;
      const rect = el.getBoundingClientRect();
      return {
        refId: id,
        tag: el.tagName.toLowerCase(),
        type: el.type || null,
        text: (el.textContent || '').trim().slice(0, 100),
        ariaLabel: el.getAttribute('aria-label') || null,
        href: el.href || null,
        placeholder: el.getAttribute('placeholder') || el.getAttribute('data-placeholder') || null,
        rect: { x: rect.x, y: rect.y, width: rect.width, height: rect.height },
      };
    });
  }

  function clickSelector(doc, target) {
    if (typeof target === 'number') {
      return doc.querySelector(`[data-gemork-ref="${target}"]`);
    }
    if (typeof target === 'string') {
      let el = doc.querySelector(target);
      if (el) return el;

      el = doc.querySelector(`[data-qa="${target}"]`);
      if (el) return el;

      if (target.startsWith('#')) {
        const channelName = target.slice(1);
        el = doc.querySelector(`.p-channel_sidebar__channel[data-qa="channel_item"]`);
        if (el && el.textContent.trim().toLowerCase().includes(channelName.toLowerCase())) {
          return el;
        }
      }

      const channels = doc.querySelectorAll('.p-channel_sidebar__channel, [data-qa="channel_item"]');
      for (const ch of channels) {
        if (ch.textContent.trim().toLowerCase() === target.toLowerCase()) {
          return ch;
        }
      }

      const buttons = doc.querySelectorAll('button, [role="button"]');
      for (const btn of buttons) {
        if (btn.getAttribute('aria-label')?.toLowerCase() === target.toLowerCase()) {
          return btn;
        }
        if (btn.textContent.trim().toLowerCase() === target.toLowerCase()) {
          return btn;
        }
      }
    }
    return null;
  }

  function typeSelector(doc, target) {
    if (typeof target === 'number') {
      return doc.querySelector(`[data-gemork-ref="${target}"]`);
    }
    if (typeof target === 'string') {
      let el = doc.querySelector(target);
      if (el) return el;

      el = doc.querySelector('.c-text_input_input, [data-qa="message_input"], .p-message_input__input');
      if (el) return el;

      el = doc.querySelector('[role="textbox"]');
      if (el) return el;

      el = doc.querySelector('textarea, input[type="text"]');
      if (el) return el;
    }
    return null;
  }

  return {
    name: 'slack',
    hostPatterns: ['slack.com', 'slack-msgs.com'],
    readPage,
    getInteractiveElements,
    clickSelector,
    typeSelector,
  };
})();

if (typeof module !== 'undefined' && module.exports) {
  module.exports = SlackAdapter;
}
