export const faces = [
    // Explicit slash faces (must be at top to prevent bare match override)
    [/^>[\\/]{2,5}<$/, { Eyes: 'Daydream', Mouth: 'Pout', Eyebrows: 'Lowered' }],
    [/^(?:>[\\/]{2,5}>|<[\\/]{2,5}<)$/, { Eyes: 'Shy', Eyebrows: 'Lowered' }],
    [/^=[\\/]{2,5}=$/, { Eyes: 'Horny', Mouth: 'Pout' }],
    [/^(?:o|0)[\\/]{2,5}(?:o|0)$/i, { Eyes: 'Surprised', Mouth: 'HalfOpen', Eyebrows: 'Raised', Blush: 'Medium' }],
    // Classic cat/cute faces
    [/^>[._~,]?<$/, { Eyes: 'Daydream', Mouth: 'Smirk' }],

    // Cat faces with W
    [/^(?:>w<)$/i, { Eyes: 'Daydream', Mouth: 'Happy' }],
    [/^(?:=w=|>w>|<w<)$/i, { Eyes: 'Horny', Mouth: 'Happy' }],

    // Cat faces with V
    [/^(?:>v<)$/i, { Eyes: 'Daydream', Mouth: 'Smile' }],
    [/^(?:=v=|>v>|<v<)$/i, { Eyes: 'Horny', Mouth: 'Smirk' }],

    // Normal cat face
    [/^(?::3|;3|:>)$/, { Mouth: 'Happy' }],

    // Happy / Smile
    [/^(?:\^_\^|\^\^|\^~\^)$/, { Eyes: 'ShylyHappy', Mouth: 'Smile' }],
    [/^xd$/i, { Eyes: 'Daydream', Mouth: 'Laughing' }],
    [/^[:;]d$/i, { Mouth: 'Laughing' }],
    [/^(?::\)|:\])$/, { Mouth: 'Smile' }],

    // Confused / Huh (Must be above Surprised to prevent /i override)
    [/^(?:O[.,_]o|o[.,_]O|0[.,_]o|o[.,_]0)$/, { Eyes: 'Dazed', Mouth: 'HalfOpen', Eyebrows: 'OneRaised' }],

    // Surprised
    [/^(?:0[._x]0|o[._x]o)$/i, { Eyes: 'Surprised', Mouth: 'HalfOpen', Eyebrows: 'Raised' }],

    // Crazy / Dazed
    [/^@[_.,~-]*@$/, { Eyes: 'Crazy', Mouth: 'Sad' }],
    [/^(?:>[.,~_]>|<[.,~_]<)$/, { Eyes: 'Dazed', Eyebrows: 'Harsh' }],

    // Horny / Closed
    [/^(?:==|=\[_\]=)$/, { Eyes: 'Horny' }],
    [/^=~=$/, { Eyes: 'Horny', Mouth: 'Frown' }],
    [/^(?:=[_^.-]=)$/, { Eyes: 'Closed', Mouth: 'Frown' }],

    // Ahegao
    [/^(?:;p|;d|;\))$/i, { Eyes: 'Closed', Eyes2: null, Mouth: 'Ahegao' }],
    [/^:p$/i, { Mouth: 'Ahegao' }],

    // Sad / Tears
    [/^(?:t[_wv.~-]?t)$/i, { Eyes: 'Shy', Mouth: 'Sad', Fluids: 'TearsHigh', Eyebrows: 'Sad' }],
    [/^qwq$/i, { Eyes: 'Shy', Mouth: 'Happy', Fluids: 'TearsHigh', Eyebrows: 'Sad' }],
    [/^:\($/, { Mouth: 'Frown' }],
    [/^D:$/i, { Eyes: 'Dazed', Mouth: 'Sad' }],
    [/^(?:twt;|x_x;|\^\^;)$/i, { Fluids: 'TearsLow' }],

    // Pout
    [/^(?:=3=|>3<|>3>|<3<)$/, { Mouth: 'Pout' }],

    // Angry
    [/^(?:>:<|>;<|>x<|>[:;xX=]|[:;xX=]<)$/i, { Eyes: 'Angry', Mouth: 'Angry', Eyebrows: 'Angry' }],

    // Floating Marks
    [/^\?$/, { Emoticon: 'Confusion' }],
    [/^!$/, { Emoticon: 'Exclamation' }],
    [/^#$/, { Emoticon: 'Annoyed' }],
    [/^\(?afk\)?$/i, { Emoticon: 'Afk' }],
    [/^\(?brb\)?$/i, { Emoticon: 'Brb' }],
    // Standalone slash/backslash blush faces
    [/^(?:[<>])?[\\/]{2,5}(?:[<>])?$/, { Blush: 'Medium' }],
];

export const knownEchoNames = new Set([
    '张开嘴', '闭上嘴', '吞咽口水', '流口水', '舔手', '舔手指', '舔脸', '舔脚', '舔牵绳手',
    '口塞亲吻嘴唇', '用嘴脱掉手套', '用嘴脱掉鞋子', '用嘴脱掉袜子', '舔触手', '舔尾巴',
    '猫爪舔手', '轻弹额头', '轻拍脑袋', '钻进怀里', '抱入怀中', '抱腿',
]);

export const mappings = [
    ['LongKiss', /深吻|Deep[ _-]?Kiss|French[ _-]?Kiss/i],
    ['KissOnLips', /接吻|亲吻|親吻|Kiss/i],
    ['Lick', /舔|吸吮|含住|用嘴脱掉|Lick|Suck/i],
    ['LipBite', /咬|Bite/i],
    ['DroolSides', /流口水|Drool/i],
    ['OpenMouth', /张开嘴|OpenMouth/i],
    ['CloseMouth', /闭上嘴|吞咽口水|CloseMouth|Swallow/i],
    ['Spank', /拍打|打屁股|轻拍|轻弹|扇耳光|Spank|Slap|Flick|Bap/i],
    ['Cuddle', /拥抱|擁抱|贴贴|貼貼|钻进怀里|抱入怀中|抱腿|Cuddle|Hug/i],
    ['Pinch', /掐|拧|Pinch/i],
    ['Hit', /(?:^|_)Hit(?:$|_)/i],
    ['ShockLight', /吓|Shock|Startle/i],
    ['Smile', /微笑|Smile/i], ['Giggle', /轻笑|Giggle/i],
    ['Laugh', /大笑|Laugh/i], ['Blush', /脸红|害羞|Blush|Shy/i],
    ['Sad', /委屈|伤心|Sad|Cry/i], ['Angry', /生气|愤怒|Angry|Mad/i],
];
export const targetOnly = new Set(['Spank', 'Hit', 'Pinch', 'ShockLight', 'LipBite']);
