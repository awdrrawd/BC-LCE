export const faces = [
    // Explicit slash/backslash faces (must be at top to prevent bare match override)
    [/^>[\\/]{2,}<$/, { Eyes: 'Daydream', Mouth: 'Pout', Eyebrows: 'Lowered', Blush: 'Medium' }],
    [/^(?:>[\\/]{2,}>|<[\\/]{2,}<)$/, { Eyes: 'Shy', Eyebrows: 'Lowered', Blush: 'Medium' }],
    [/^=[\\/]{2,}=$/, { Eyes: 'Horny', Mouth: 'Pout', Blush: 'Medium' }],
    [/^(?:o|0)[\\/]{2,}(?:o|0)$/i, { Eyes: 'Surprised', Mouth: 'HalfOpen', Eyebrows: 'Raised', Blush: 'Medium' }],
    [/^\^[\\/]{2,}\^$/, { Eyes: 'ShylyHappy', Mouth: 'Smile', Blush: 'Medium' }],
    // Classic cat/cute faces
    [/^>~<$/, { Eyes: 'Daydream', Mouth: 'Smirk' }],
    [/^>[._,]?<$/, { Eyes: 'Daydream' }],
    // Cat faces with W
    [/^(?:>w<)$/i, { Eyes: 'Daydream', Mouth: 'Happy' }],
    [/^(?:=w=|>w>|<w<)$/i, { Eyes: 'Horny', Mouth: 'Happy' }],
    // Cat faces with V
    [/^(?:>v<)$/i, { Eyes: 'Daydream', Mouth: 'Smile' }],
    [/^(?:=v=|>v>|<v<)$/i, { Eyes: 'Horny', Mouth: 'Smirk' }],
    // Normal cat face
    [/^(?::3|:>)$/, { Mouth: 'Happy' }],
    // Winking cat face
    [/^(?:;3|;>)$/, { Eyes: 'Closed', Eyes2: null, Mouth: 'Happy' }],
    // Happy / Smile
    [/^(?:\^_\^|\^\^|\^~\^)$/, { Eyes: 'ShylyHappy', Mouth: 'Smile' }],
    [/^xd$/i, { Eyes: 'Daydream', Mouth: 'Laughing' }],
    [/^[:;]d$/i, { Mouth: 'Laughing' }],
    [/^(?::\)|:\])$/, { Mouth: 'Smile' }],
    // Confused / Huh
    [/^(?:O[.,_]o|o[.,_]O|0[.,_]o|o[.,_]0)$/, { Eyes: 'Dazed', Mouth: 'HalfOpen', Eyebrows: 'OneRaised' }],
    // Surprised
    [/^(?:0[._x]0|o[._x]o)$/i, { Eyes: 'Surprised', Mouth: 'HalfOpen', Eyebrows: 'Raised' }],
    // Crazy / Dazed
    [/^x[_.]?x$/i, { Eyes: 'Dazed', Mouth: 'Sad' }],
    [/^@[_.,~-]*@$/, { Eyes: 'Crazy', Mouth: 'Sad' }],
    [/^(?:>[.,~_]{1,2}>|<[.,~_]{1,2}<|>{2,3}|<{2,3})$/, { Eyes: 'Dazed', Eyebrows: 'Harsh' }],
    // Horny / Closed
    [/^(?:==|=\[_\]=)$/, { Eyes: 'Horny' }],
    [/^(?:=~=|=\.=|=,=)$/, { Eyes: 'Horny', Mouth: 'Frown' }],
    [/^(?:=[_^-]=)$/, { Eyes: 'Closed', Mouth: 'Frown' }],
    [/^-_-$/, { Eyes: 'Dazed', Eyebrows: 'Harsh', Mouth: 'Frown' }],
    // Ahegao
    [/^(?:;p|;d|;\))$/i, { Eyes: 'Closed', Eyes2: null, Mouth: 'Ahegao' }],
    [/^:p$/i, { Mouth: 'Ahegao' }],
    // Sad / Tears
    [/^(?:t[_xwv.~-]?t)$/i, { Eyes: 'Shy', Mouth: 'Sad', Fluids: 'TearsHigh', Eyebrows: 'Sad' }],
    [/^qwq$/i, { Eyes: 'Shy', Mouth: 'Happy', Fluids: 'TearsHigh', Eyebrows: 'Sad' }],
    [/^:\($/, { Mouth: 'Frown' }],
    [/^D:$/i, { Eyes: 'Dazed', Mouth: 'Sad' }],
    // Pout
    [/^(?:=3=|>3<|>3>|<3<)$/, { Mouth: 'Pout' }],
    // Angry
    [/^(?:>:<|>;<|>x<|>[:;xX=]|[:;xX=]<)$/i, { Eyes: 'Angry', Mouth: 'Angry', Eyebrows: 'Angry' }],
    // Standalone slash/backslash blush faces
    [/^(?:[<>])?[\\/]{2,}(?:[<>])?$/, { Blush: 'Medium' }],
    // Hearts and Sleep
    [/^<3+$/i, { Emoticon: 'Hearts' }],
    [/^z{3,}[.~]*$/i, { Eyes: 'Closed', Emoticon: 'Sleep' }]
];

export const knownEchoNames = new Set([
    '张开嘴', '闭上嘴', '吞咽口水', '流口水', '舔手', '舔手指', '舔脸', '舔脚', '舔牵绳手',
    '口塞亲吻嘴唇', '用嘴脱掉手套', '用嘴脱掉鞋子', '用嘴脱掉袜子', '舔触手', '舔尾巴',
    '猫爪舔手', '轻弹额头', '轻拍脑袋', '钻进怀里', '抱入怀中', '抱腿',
    'Flick', 'FlickForehead',
]);

export const mappings = [
    ['LongKiss', /深吻|(?<![a-z0-9])(?:Deep|French)[ _-]?Kiss(?:es|ed|ing)?(?![a-z0-9])/i],
    ['KissOnLips', /接吻|亲吻|親吻|(?<![a-z0-9])Kiss(?:es|ed|ing)?(?![a-z0-9])/i],
    ['Lick', /舔|吸吮|含住|用嘴脱掉|(?<![a-z0-9])(?:Lick|Suck)(?:s|ed|ing)?(?![a-z0-9])/i],
    ['LipBite', /咬|(?<![a-z0-9])Bit(?:e|es|ing|ten)?(?![a-z0-9])/i],
    ['DroolSides', /流口水|(?<![a-z0-9])Drool(?:s|ed|ing)?(?![a-z0-9])/i],
    ['OpenMouth', /张开嘴|(?<![a-z0-9])Open[ _-]?Mouth(?![a-z0-9])/i],
    ['CloseMouth', /闭上嘴|吞咽口水|(?<![a-z0-9])(?:Close[ _-]?Mouth|Swallow(?:s|ed|ing)?)(?![a-z0-9])/i],
    ['Spank', /拍打|打屁股|轻拍|轻弹|扇耳光|(?<![a-z0-9])(?:Spank(?:s|ed|ing)?|Slap(?:s|ped|ping)?|Flick(?:s|ed|ing)?|Bap(?:s|ped|ping)?)(?![a-z0-9])/i],
    ['Cuddle', /拥抱|擁抱|贴贴|貼貼|钻进怀里|抱入怀中|抱腿|(?<![a-z0-9])(?:Cuddl(?:e|es|ed|ing)|Hug(?:s|ged|ging)?)(?![a-z0-9])/i],
    ['Pinch', /掐|拧|(?<![a-z0-9])Pinch(?:es|ed|ing)?(?![a-z0-9])/i],
    ['Hit', /(?:^|_)Hit(?:$|_)|(?<![a-z0-9])Hit(?:s|ting)?(?![a-z0-9])/i],
    ['ShockLight', /吓|(?<![a-z0-9])(?:Shock(?:s|ed|ing)?|Startl(?:e|es|ed|ing))(?![a-z0-9])/i],
    ['Smile', /微笑|(?<![a-z0-9])Smil(?:e|es|ed|ing)(?![a-z0-9])/i],
    ['Giggle', /轻笑|(?<![a-z0-9])Giggl(?:e|es|ed|ing)(?![a-z0-9])/i],
    ['Laugh', /大笑|(?<![a-z0-9])Laugh(?:s|ed|ing)?(?![a-z0-9])/i],
    ['Blush', /脸红|害羞|(?<![a-z0-9])(?:Blush(?:es|ed|ing)?|Shy)(?![a-z0-9])/i],
    ['Sad', /委屈|伤心|(?<![a-z0-9])(?:Sad|Cry(?:ing|ies)?|Cried)(?![a-z0-9])/i],
    ['Angry', /生气|愤怒|(?<![a-z0-9])(?:Angry|Mad)(?![a-z0-9])/i],
];
export const targetOnly = new Set(['Spank', 'Hit', 'Pinch', 'ShockLight', 'LipBite']);
export const senderOnly = new Set(['Lick']);
