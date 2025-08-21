require('dotenv').config();
const TelegramBot = require('node-telegram-bot-api');
const axios = require('axios');
const NodeCache = require('node-cache');
const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const STORE_API_URL = 'https://store.steampowered.com/api';
let BOT_USERNAME = process.env.BOT_USERNAME;

if (!TELEGRAM_BOT_TOKEN) {
  console.error('Ошибка: TELEGRAM_BOT_TOKEN не указан в файле .env');
  process.exit(1);
}

if (!BOT_USERNAME) {
  console.warn('Предупреждение: BOT_USERNAME не указан в файле .env');
  BOT_USERNAME = 'your_bot_username';
}

const bot = new TelegramBot(TELEGRAM_BOT_TOKEN, { 
  polling: true,
  onlyFirstMatch: true
});
const cache = new NodeCache({ stdTTL: 86400 });
const userSubscriptions = new Map();
const userStates = new Map();
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));

console.log('Бот запущен... by PagilaYaGorilla');

const mainMenu = {
  reply_markup: {
    inline_keyboard: [
      [
        { text: '🔍 Поиск игры', switch_inline_query_current_chat: '' },
        { text: '🎮 Мои подписки', callback_data: 'my_subs' }
      ],
      [
        { text: '💰 Топ скидок', callback_data: 'top_deals' },
        { text: '🆓 Бесплатные игры', callback_data: 'free_games' }
      ],
      [
        { text: '🎯 Рекомендации', callback_data: 'recommendations' },
        { text: '📊 Статистика', callback_data: 'stats' }
      ],
      [
        { text: '❓ Помощь', callback_data: 'help' }
      ]
    ]
  }
};

bot.onText(/\/start/, (msg) => {
  const chatId = msg.chat.id;
  const welcomeText = `
🎮 <b>Добро пожаловать в Steam Price Tracker Bot!</b>

С помощью этого бота вы можете:
• Отслеживать изменения цен на игры в Steam
• Получать уведомления о скидках
• Искать информацию об играх
• Находить лучшие предложения

<b>Используйте кнопки ниже для навигации:</b>
  `;

  bot.sendMessage(chatId, welcomeText, {
    parse_mode: 'HTML',
    reply_markup: mainMenu.reply_markup
  });
});

bot.on('callback_query', async (callbackQuery) => {
  const chatId = callbackQuery.message.chat.id;
  const messageId = callbackQuery.message.message_id;
  const data = callbackQuery.data;

  try {
    await bot.deleteMessage(chatId, messageId);
  } catch (error) {
    console.log('Не удалось удалить сообщение:', error.message);
  }

  switch (data) {
    case 'main_menu':
      showMainMenu(chatId);
      break;
    case 'my_subs':
      showSubscriptions(chatId);
      break;
    case 'top_deals':
      showTopDeals(chatId);
      break;
    case 'free_games':
      showFreeGames(chatId);
      break;
    case 'recommendations':
      showRecommendations(chatId);
      break;
    case 'stats':
      showStats(chatId);
      break;
    case 'help':
      showHelp(chatId);
      break;
    default:
      if (data.startsWith('game_')) {
        const appId = data.split('_')[1];
        showGameInfo(chatId, appId);
      } else if (data.startsWith('sub_')) {
        const appId = data.split('_')[1];
        subscribeToGame(chatId, appId);
      } else if (data.startsWith('unsub_')) {
        const appId = data.split('_')[1];
        unsubscribeFromGame(chatId, appId);
      } else if (data.startsWith('info_')) {
        const appId = data.split('_')[1];
        showGameInfo(chatId, appId);
      }
  }

  await bot.answerCallbackQuery(callbackQuery.id);
});

function showMainMenu(chatId) {
  const menuText = `
<b>Главное меню</b>

Выберите действие с помощью кнопок ниже:
  `;

  bot.sendMessage(chatId, menuText, {
    parse_mode: 'HTML',
    reply_markup: mainMenu.reply_markup
  });
}

async function showSubscriptions(chatId) {
  const subscriptions = userSubscriptions.get(chatId);
  
  if (!subscriptions || subscriptions.size === 0) {
    return bot.sendMessage(chatId, 'У вас нет активных подписок. Используйте поиск, чтобы добавить игры.', {
      reply_markup: {
        inline_keyboard: [
          [{ text: '🔍 Поиск игр', switch_inline_query_current_chat: '' }],
          [{ text: '◀️ Назад', callback_data: 'main_menu' }]
        ]
      }
    });
  }
  
  let message = '🎮 <b>Ваши подписки:</b>\n\n';
  const keyboard = [];
  
  subscriptions.forEach((gameInfo, appId) => {
    const cachedGame = cache.get(`game_${appId}`);
    message += `▪️ ${cachedGame ? cachedGame.name : gameInfo.name}\n`;
    keyboard.push([
      { 
        text: `${cachedGame ? cachedGame.name : gameInfo.name}`, 
        callback_data: `info_${appId}` 
      }
    ]);
  });
  
  keyboard.push([{ text: '◀️ Назад', callback_data: 'main_menu' }]);
  
  bot.sendMessage(chatId, message, {
    parse_mode: 'HTML',
    reply_markup: {
      inline_keyboard: keyboard
    }
  });
}

async function showGameInfo(chatId, appId) {
  try {
    const response = await axios.get(`${STORE_API_URL}/appdetails/`, {
      params: { appids: appId, l: 'russian' }
    });
    
    if (!response.data[appId].success) {
      return bot.sendMessage(chatId, 'Не удалось загрузить информацию об игре.', {
        reply_markup: {
          inline_keyboard: [
            [{ text: '◀️ Назад', callback_data: 'my_subs' }]
          ]
        }
      });
    }
    
    const game = response.data[appId].data;
    const isSubscribed = userSubscriptions.get(chatId)?.has(appId);
    
    const message = `
🎮 <b>${game.name}</b>

📅 <b>Дата выхода:</b> ${game.release_date?.date || 'Неизвестно'}
⭐ <b>Рейтинг:</b> ${game.metacritic?.score || 'Н/А'}
💾 <b>Жанры:</b> ${game.genres?.map(g => g.description).join(', ') || 'Не указаны'}
👥 <b>Разработчик:</b> ${game.developers?.join(', ') || 'Не указан'}

💰 <b>Цена:</b> ${game.price_overview ? `${game.price_overview.final/100}₽` : 'Бесплатно'}
${game.price_overview ? `📉 <b>Скидка:</b> ${game.price_overview.discount_percent}%` : ''}

${game.short_description || ''}
    `;
    
    const keyboard = [];
    
    if (isSubscribed) {
      keyboard.push([{ text: '❌ Отписаться', callback_data: `unsub_${appId}` }]);
    } else {
      keyboard.push([{ text: '✅ Подписаться', callback_data: `sub_${appId}` }]);
    }

    keyboard.push([{ text: '🔼 Открыть в Steam', url: `https://store.steampowered.com/app/${appId}` }]);
    
    keyboard.push([{ text: '◀️ Назад к подпискам', callback_data: 'my_subs' }]);
    
    let options = {
      parse_mode: 'HTML',
      reply_markup: {
        inline_keyboard: keyboard
      }
    };
    
    if (game.screenshots && game.screenshots.length > 0) {
      options.caption = message;
      options.parse_mode = 'HTML';
      
      return bot.sendPhoto(chatId, game.screenshots[0].path_thumbnail, options);
    }
    
    bot.sendMessage(chatId, message, options);
  } catch (error) {
    console.error('Ошибка при получении информации об игре:', error);
    bot.sendMessage(chatId, 'Произошла ошибка при загрузке информации об игре.', {
      reply_markup: {
        inline_keyboard: [
          [{ text: '◀️ Назад', callback_data: 'my_subs' }]
        ]
      }
    });
  }
}

async function showTopDeals(chatId) {
  try {
    const response = await axios.get('https://store.steampowered.com/api/featuredcategories?cc=RU&l=russian');
    const specials = response.data.specials?.items || [];
    
    if (specials.length === 0) {
      return bot.sendMessage(chatId, 'В настоящее время нет специальных предложений.', {
        reply_markup: {
          inline_keyboard: [
            [{ text: '◀️ Назад', callback_data: 'main_menu' }]
          ]
        }
      });
    }
    
    let message = '🔥 <b>Топ скидок в Steam:</b>\n\n';
    const keyboard = [];
    
    specials.slice(0, 5).forEach(game => {
      const discount = game.discount_percent || 0;
      const finalPrice = game.final_price / 100;
      const originalPrice = game.original_price / 100;
      
      message += `🎮 <b>${game.name}</b>\n`;
      message += `💰 <s>${originalPrice}₽</s> ${finalPrice}₽ (-${discount}%)\n\n`;
      
      keyboard.push([
        { 
          text: `✅ ${game.name} (${discount}%)`, 
          callback_data: `info_${game.id}` 
        }
      ]);
    });
    
    keyboard.push([{ text: '◀️ Назад', callback_data: 'main_menu' }]);
    
    bot.sendMessage(chatId, message, {
      parse_mode: 'HTML',
      reply_markup: {
        inline_keyboard: keyboard
      }
    });
  } catch (error) {
    console.error('Ошибка при получении топа скидок:', error);
    bot.sendMessage(chatId, 'Произошла ошибка при загрузке списка скидок.', {
      reply_markup: {
        inline_keyboard: [
          [{ text: '◀️ Назад', callback_data: 'main_menu' }]
        ]
      }
    });
  }
}

async function showFreeGames(chatId) {
  try {
    const response = await axios.get('https://store.steampowered.com/api/featuredcategories?cc=RU&l=russian');
    
    let freeGames = [];
    
    const sectionsToCheck = [
      'featured_win', 'featured_mac', 'featured_linux',
      'specials', 'coming_soon', 'new_releases', 'top_sellers'
    ];
    
    for (const section of sectionsToCheck) {
      if (response.data[section] && response.data[section].items) {
        const gamesInSection = response.data[section].items;
        const freeInSection = gamesInSection.filter(game => game.final_price === 0);
        freeGames = freeGames.concat(freeInSection);
      }
    }
    
    if (freeGames.length === 0) {
      for (const section of sectionsToCheck) {
        if (response.data[section] && response.data[section].items) {
          freeGames = freeGames.concat(response.data[section].items.slice(0, 2));
        }
      }
      
      if (freeGames.length === 0) {
        return bot.sendMessage(chatId, 'В настоящее время нет бесплатных игр.', {
          reply_markup: {
            inline_keyboard: [
              [{ text: '◀️ Назад', callback_data: 'main_menu' }]
            ]
          }
        });
      }
      
      let message = '🎮 <b>Популярные игры:</b>\n\n';
      const keyboard = [];
      
      const uniqueGames = [];
      const seenIds = new Set();
      
      for (const game of freeGames) {
        if (!seenIds.has(game.id)) {
          seenIds.add(game.id);
          uniqueGames.push(game);
          if (uniqueGames.length >= 5) break;
        }
      }
      
      uniqueGames.forEach(game => {
        const price = game.final_price > 0 ? `${game.final_price/100}₽` : 'Бесплатно';
        message += `🎮 <b>${game.name}</b>\n`;
        message += `💰 ${price}\n`;
        message += `⭐ Рейтинг: ${game.metacritic_score || 'Н/А'}\n\n`;
        
        keyboard.push([
          { 
            text: `✅ ${game.name.substring(0, 15)}${game.name.length > 15 ? '...' : ''}`, 
            callback_data: `info_${game.id}` 
          }
        ]);
      });
      
      keyboard.push([{ text: '◀️ Назад', callback_data: 'main_menu' }]);
      
      return bot.sendMessage(chatId, message, {
        parse_mode: 'HTML',
        reply_markup: {
          inline_keyboard: keyboard
        }
      });
    }
    
    let message = '🆓 <b>Бесплатные игры в Steam:</b>\n\n';
    const keyboard = [];
    const uniqueGames = [];
    const seenIds = new Set();
    
    for (const game of freeGames) {
      if (!seenIds.has(game.id)) {
        seenIds.add(game.id);
        uniqueGames.push(game);
      }
    }
    
    uniqueGames.slice(0, 5).forEach(game => {
      message += `🎮 <b>${game.name}</b>\n`;
      message += `⭐ Рейтинг: ${game.metacritic_score || 'Н/А'}\n\n`;
      
      keyboard.push([
        { 
          text: `✅ ${game.name.substring(0, 15)}${game.name.length > 15 ? '...' : ''}`, 
          callback_data: `info_${game.id}` 
        }
      ]);
    });
    
    keyboard.push([{ text: '◀️ Назад', callback_data: 'main_menu' }]);
    
    bot.sendMessage(chatId, message, {
      parse_mode: 'HTML',
      reply_markup: {
        inline_keyboard: keyboard
      }
    });
  } catch (error) {
    console.error('Ошибка при получении бесплатных игр:', error);
    bot.sendMessage(chatId, 'Произошла ошибка при загрузке списка бесплатных игр.', {
      reply_markup: {
        inline_keyboard: [
          [{ text: '◀️ Назад', callback_data: 'main_menu' }]
        ]
      }
    });
  }
}

async function showRecommendations(chatId) {

    try {
    const response = await axios.get('https://store.steampowered.com/api/featuredcategories?cc=RU&l=russian');
    let popularGames = [];
    const possibleSections = [
      'featured_win', 'featured_mac', 'featured_linux',
      'specials', 'top_sellers', 'new_releases'
    ];
    
    for (const section of possibleSections) {
      if (response.data[section] && response.data[section].items) {
        popularGames = popularGames.concat(response.data[section].items);
        if (popularGames.length >= 10) break;
      }
    }
    
    if (popularGames.length === 0) {
      return bot.sendMessage(chatId, 'Не удалось загрузить рекомендации.', {
        reply_markup: {
          inline_keyboard: [
            [{ text: '◀️ Назад', callback_data: 'main_menu' }]
          ]
        }
      });
    }
    
    let message = '🎯 <b>Рекомендуемые игры:</b>\n\n';
    const keyboard = [];
    
    popularGames.slice(0, 5).forEach(game => {
      const price = game.final_price > 0 ? `${game.final_price/100}₽` : 'Бесплатно';
      const discount = game.discount_percent > 0 ? ` (скидка ${game.discount_percent}%)` : '';
      
      message += `🎮 <b>${game.name}</b>\n`;
      message += `💰 ${price}${discount}\n`;
      message += `⭐ Рейтинг: ${game.metacritic_score || 'Н/А'}\n\n`;
      
      keyboard.push([
        { 
          text: `ℹ️ ${game.name.substring(0, 15)}${game.name.length > 15 ? '...' : ''}`, 
          callback_data: `info_${game.id}` 
        }
      ]);
    });
    
    keyboard.push([{ text: '◀️ Назад', callback_data: 'main_menu' }]);
    
    bot.sendMessage(chatId, message, {
      parse_mode: 'HTML',
      reply_markup: {
        inline_keyboard: keyboard
      }
    });
  } catch (error) {
    console.error('Ошибка при получении рекомендаций:', error);
    bot.sendMessage(chatId, 'Произошла ошибка при загрузке рекомендаций.', {
      reply_markup: {
        inline_keyboard: [
          [{ text: '◀️ Назад', callback_data: 'main_menu' }]
        ]
      }
    });
  }
}

function showStats(chatId) {
  const totalUsers = userSubscriptions.size;
  let totalSubscriptions = 0;
  
  userSubscriptions.forEach(subs => {
    totalSubscriptions += subs.size;
  });
  
  const message = `
📊 <b>Статистика бота:</b>

👥 Всего пользователей: ${totalUsers}
🎮 Всего подписок: ${totalSubscriptions}
📈 Среднее количество подписок на пользователя: ${totalUsers > 0 ? (totalSubscriptions / totalUsers).toFixed(1) : 0}
  `;
  
  bot.sendMessage(chatId, message, {
    parse_mode: 'HTML',
    reply_markup: {
      inline_keyboard: [
        [{ text: '◀️ Назад', callback_data: 'main_menu' }]
      ]
    }
  });
}

function showHelp(chatId) {
  const message = `
❓ <b>Помощь по использованию бота</b>

<b>Основные возможности:</b>
• 🔍 <b>Поиск игры</b> - найдите игру для отслеживания
• 🎮 <b>Мои подписки</b> - просмотр отслеживаемых игр
• 💰 <b>Топ скидок</b> - лучшие предложения Steam
• 🆓 <b>Бесплатные игры</b> - текущие бесплатные предложения

<b>Как использовать:</b>
1. Используйте кнопку "Поиск игры" для поиска
2. Нажмите на игру в результатах поиска
3. Нажмите "Подписаться" для отслеживания цены
4. Получайте уведомления о снижении цены!

<b>Команды:</b>
/start - Главное меню
/trackgame [название] - Поиск игры
/mysubscriptions - Мои подписки
  `;
  
  bot.sendMessage(chatId, message, {
    parse_mode: 'HTML',
    reply_markup: {
      inline_keyboard: [
        [{ text: '◀️ Назад', callback_data: 'main_menu' }]
      ]
    }
  });
}

async function subscribeToGame(chatId, appId) {
  try {
    const response = await axios.get(`${STORE_API_URL}/appdetails/`, {
      params: { appids: appId, l: 'russian' }
    });
    
    if (!response.data[appId].success) {
      throw new Error('Игра не найдена');
    }
    
    const game = response.data[appId].data;
    
    if (!userSubscriptions.has(chatId)) {
      userSubscriptions.set(chatId, new Map());
    }
    
    userSubscriptions.get(chatId).set(appId, {
      name: game.name,
      initialPrice: game.price_overview ? game.price_overview.final : 0,
      lastChecked: Date.now()
    });
    
    cache.set(`game_${appId}`, {
      name: game.name,
      price: game.price_overview ? game.price_overview.final : 0
    });
    
    showGameInfo(chatId, appId);
    
    return true;
  } catch (error) {
    console.error('Ошибка при подписке на игру:', error);
    bot.sendMessage(chatId, 'Произошла ошибка при добавлении игры. Попробуйте позже.', {
      reply_markup: {
        inline_keyboard: [
          [{ text: '◀️ Назад', callback_data: 'my_subs' }]
        ]
      }
    });
    return false;
  }
}

function unsubscribeFromGame(chatId, appId) {
  if (userSubscriptions.has(chatId)) {
    const hadGame = userSubscriptions.get(chatId).delete(appId);
    
    if (hadGame) {
      bot.sendMessage(chatId, `Игра удалена из отслеживаемых.`, {
        reply_markup: {
          inline_keyboard: [
            [{ text: '◀️ Назад к подпискам', callback_data: 'my_subs' }]
          ]
        }
      });
    }
  }
}

bot.on('inline_query', async (inlineQuery) => {
  const query = inlineQuery.query;
  const offset = inlineQuery.offset || '0';
  
  if (!query || query.length < 3) {
    return bot.answerInlineQuery(inlineQuery.id, [], {
      switch_pm_text: 'Введите минимум 3 символа',
      switch_pm_parameter: 'start',
      cache_time: 0
    });
  }
  
  try {
    const response = await axios.get('https://store.steampowered.com/api/storesearch', {
      params: {
        term: query,
        cc: 'RU',
        l: 'ru',
        limit: 10
      }
    });
    
    if (!response.data.items || response.data.items.length === 0) {
      return bot.answerInlineQuery(inlineQuery.id, [], {
        switch_pm_text: 'Игры не найдены',
        switch_pm_parameter: 'start',
        cache_time: 0
      });
    }
    
    const results = response.data.items.map((game, index) => {
      const price = game.price ? `${game.price.final / 100}₽` : 'Бесплатно';
      const discount = game.price && game.price.discount_percent > 0 ? ` (-${game.price.discount_percent}%)` : '';
      
      return {
        type: 'article',
        id: index.toString(),
        title: game.name,
        description: `${price}${discount}`,
        thumb_url: game.tiny_image,
        input_message_content: {
          message_text: `/trackgame_select ${game.id}`
        },
        reply_markup: {
          inline_keyboard: [[
            {
              text: 'Выбрать эту игру',
              callback_data: `select_${game.id}`
            }
          ]]
        }
      };
    });
    
    bot.answerInlineQuery(inlineQuery.id, results, {
      cache_time: 0,
      is_personal: true
    });
  } catch (error) {
    console.error('Ошибка при поиске игр:', error);
    bot.answerInlineQuery(inlineQuery.id, [], {
      switch_pm_text: 'Произошла ошибка при поиске',
      switch_pm_parameter: 'start',
      cache_time: 0
    });
  }
});

bot.onText(/\/trackgame_select (.+)/, async (msg, match) => {
  const chatId = msg.chat.id;
  const appId = match[1];
  
  try {
    await bot.deleteMessage(chatId, msg.message_id);
  } catch (error) {
    console.log('Не удалось удалить сообщение:', error.message);
  }
  
  await subscribeToGame(chatId, appId);
});

setInterval(async () => {
  console.log('Проверка цен на игры...');
  
  for (let [chatId, subscriptions] of userSubscriptions) {
    for (let [appId, gameInfo] of subscriptions) {
      try {
        await delay(2000);
        
        const response = await axios.get(`${STORE_API_URL}/appdetails/`, {
          params: { appids: appId, l: 'russian' }
        });
        
        if (response.data[appId].success) {
          const game = response.data[appId].data;
          const newPrice = game.price_overview ? game.price_overview.final : 0;
          const oldPrice = gameInfo.initialPrice;
          
          if (newPrice < oldPrice) {
            const discount = Math.round((1 - newPrice / oldPrice) * 100);
            const message = `
🎮 <b>${game.name} со скидкой ${discount}%!</b>

💵 <b>Новая цена:</b> ${newPrice / 100}₽
📉 <b>Старая цена:</b> ${oldPrice / 100}₽
💰 <b>Экономия:</b> ${(oldPrice - newPrice) / 100}₽

🛒 <a href="https://store.steampowered.com/app/${appId}">Купить в Steam</a>
            `;
            
            bot.sendMessage(chatId, message, {
              parse_mode: 'HTML',
              reply_markup: {
                inline_keyboard: [
                  [{ text: '🛒 Перейти к игре', url: `https://store.steampowered.com/app/${appId}` }],
                  [{ text: '❌ Отписаться', callback_data: `unsub_${appId}` }]
                ]
              }
            });
            
            gameInfo.initialPrice = newPrice;
            gameInfo.lastChecked = Date.now();
          }
        }
      } catch (error) {
        console.error('Ошибка при проверке цены для игры', appId, error.message);
      }
    }
  }
}, 24 * 60 * 60 * 1000); 

bot.onText(/\/trackgame (.+)?/, async (msg, match) => {
  const chatId = msg.chat.id;
  const query = match[1];
  
  if (!query) {
    return bot.sendMessage(chatId, 'Введите название игры после команды /trackgame');
  }
  
  bot.sendMessage(chatId, 'Нажмите на кнопку ниже для поиска игры', {
    reply_markup: {
      inline_keyboard: [[
        {
          text: '🔍 Найти игру',
          switch_inline_query_current_chat: query
        }
      ]]
    }
  });
});

bot.onText(/\/mysubscriptions/, (msg) => {
  const chatId = msg.chat.id;
  showSubscriptions(chatId);
});

bot.onText(/\/help/, (msg) => {
  const chatId = msg.chat.id;
  showHelp(chatId);
});
