// Declarative textmoji and Echo mappings. No hooks, settings or timers here.
export const faces = [
    [/^(?:>\.<|><|>_<|>w<|>v<)$/i, { Eyes: 'Daydream', Mouth: 'Smirk' }],
    [/^(?::3|;3|:>)$/, { Mouth: 'Smirk' }],
    [/^(?:=w=|>w>|<w<|=v=|>v>|<v<)$/i, { Eyes: 'Horny', Mouth: 'Smirk' }],
    [/^=[\\/]{2,5}=$/, { Eyes: 'Horny', Mouth: 'Smirk', Blush: 'Medium' }],
    [/^(?:\^_\^|\^\^|\^~\^)$/, { Eyes: 'ShylyHappy', Mouth: 'Smile' }],
    [/^xd$/i, { Eyes: 'Daydream', Mouth: 'Laughing' }],
    [/^(?::\)|:\])$/, { Mouth: 'Smile' }],
    [/^(?:0[._x]0|o[._x]o)$/i, { Eyes: 'Surprised' }],
    [/^(?:0|o)[\\/]{2,5}(?:0|o)$/i, { Eyes: 'Surprised', Blush: 'Medium' }],
    [/^@[_.,~-]*@$/, { Eyes: 'Crazy' }],
    [/^(?:==|=\[_\]=)$/, { Eyes: 'Horny' }],
    [/^(?:;p|;d|;\))$/i, { Eyes: 'Closed', Eyes2: null, Mouth: 'Ahegao' }],
    [/^:p$/i, { Mouth: 'Ahegao' }],
    [/^(?:>\.>|<\.<|>~>)$/, { Eyes: 'Dazed' }],
    [/^(?:t[_wxv.-]?t|qwq)$/i, { Eyes: 'Dazed', Fluids: 'TearsHigh' }],
    [/^(?::\(|=~=)$/, { Mouth: 'Frown' }],
    [/^(?:=3=|>3<)$/, { Mouth: 'Pout' }],
    [/^(?:>:<|>;<|>x<)$/, { Eyes: 'Angry', Mouth: 'Angry' }],
    [/^(?:twt;|x_x;|\^\^;)$/i, { Fluids: 'TearsLow' }],
    [/^(?:[<>])?[\\/]{2,5}(?:[<>])?$/, { Blush: 'Medium' }],
    [/^\?$/, { Emoticon: 'Confusion' }],
    [/^!$/, { Emoticon: 'Exclamation' }],
    [/^#$/, { Emoticon: 'Annoyed' }],
    [/^\(?afk\)?$/i, { Emoticon: 'Afk' }],
    [/^\(?brb\)?$/i, { Emoticon: 'Brb' }],
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

