// 简易拼音映射表（常用汉字）
const PINYIN_MAP: Record<string, string> = {
  '周': 'zhou', '杰': 'jie', '伦': 'lun',
  '林': 'lin', '俊': 'jun',
  '陈': 'chen', '奕': 'yi', '迅': 'xun',
  '薛': 'xue', '之': 'zhi', '谦': 'qian',
  '邓': 'deng', '紫': 'zi', '棋': 'qi',
  '张': 'zhang', '学': 'xue', '友': 'you',
  '刘': 'liu', '德': 'de', '华': 'hua',
  '王': 'wang', '菲': 'fei',
  '李': 'li', '荣': 'rong',
  '蔡': 'cai', '依': 'yi',
  '孙': 'sun', '燕': 'yan', '姿': 'zi',
  '梁': 'liang', '静': 'jing', '茹': 'ru',
  '许': 'xu', '嵩': 'song',
  '毛': 'mao', '不': 'bu', '易': 'yi',
  '赵': 'zhao', '雷': 'lei',
  '田': 'tian', '馥': 'fu', '甄': 'zhen',
  '光': 'guang', '良': 'liang',
  '国': 'guo',
  '谭': 'tan', '咏': 'yong', '麟': 'lin',
  '慧': 'hui', '娴': 'xian',
  '惠': 'hui', '妹': 'mei',
  '莫': 'mo', '文': 'wen', '蔚': 'wei',
  '萧': 'xiao', '敬': 'jing', '腾': 'teng',
  '吴': 'wu', '克': 'ke', '群': 'qun',
  '齐': 'qi', '秦': 'qin',
  '费': 'fei', '翔': 'xiang',
  '忆': 'yi', '莲': 'lian',
  '范': 'fan', '玮': 'wei', '琪': 'qi',
  '苏': 'su', '芮': 'rui',
  '信': 'xin',
  '伍': 'wu', '佰': 'bai',
  '谢': 'xie', '霆': 'ting', '锋': 'feng',
  '容': 'rong', '祖': 'zu', '儿': 'er',
  '古': 'gu', '巨': 'ju', '基': 'ji',
  '勤': 'qin',
  '小': 'xiao', '春': 'chun',
  '方': 'fang', '大': 'da', '同': 'tong',
  '罗': 'luo', '志': 'zhi', '祥': 'xiang',
  '永': 'yong', '康': 'kang',
  '健': 'jian',
  '任': 'ren', '贤': 'xian',
  '力': 'li', '宏': 'hong',
  '潘': 'pan', '柏': 'bai',
  '陶': 'tao', '喆': 'zhe',
  '庾': 'yu', '澄': 'cheng', '庆': 'qing',
  '亚': 'ya', '轩': 'xuan',
  '心': 'xin', '凌': 'ling',
  '杨': 'yang', '丞': 'cheng', '琳': 'lin',
  '戴': 'dai', '佩': 'pei', '妮': 'ni',
  '黄': 'huang', '琥': 'hu',
  '彭': 'peng', '佳': 'jia',
  '徐': 'xu', '莹': 'ying',
  '若': 'ruo', '英': 'ying',
  '雅': 'ya',
  '韶': 'shao', '涵': 'han',
  '宥': 'you', '嘉': 'jia',
  '韦': 'wei', '礼': 'li', '安': 'an',
  '闳': 'hong', '贺': 'he',
  '严': 'yan', '爵': 'jue',
  '立': 'li', '农': 'nong',
  '晨': 'chen', '宇': 'yu',
  '凯': 'kai',
  '尔': 'er',
  '魏': 'wei',
  '碧': 'bi',
  '少': 'shao',
  '哲': 'zhe',
  '炫': 'xuan',
  '传': 'chuan', '雄': 'xiong',
  '品': 'pin', '源': 'yuan',
  '煌': 'huang', '奇': 'qi',
  '峰': 'feng',
  '建': 'jian', '豪': 'hao',
  '逸': 'yi', '臣': 'chen',
  '邱': 'qiu', '泽': 'ze',
  '炯': 'jiong',
  '鸿': 'hong',
  '欣': 'xin',
  '兴': 'xing',
  '典': 'dian',
  '旻': 'min',
  '晰': 'xi',
  '凡': 'fan',
  '汤': 'tang',
  '超': 'chao',
  '程': 'cheng',
  '磊': 'lei',
  '博': 'bo',
  '浩': 'hao',
  '鹏': 'peng',
  '刚': 'gang',
  '强': 'qiang',
  '伟': 'wei',
  '军': 'jun',
  '涛': 'tao',
  '斌': 'bin',
  '明': 'ming',
  '亮': 'liang',
};

/**
 * 获取汉字的拼音首字母
 */
export function getFirstLetter(char: string): string {
  const pinyin = PINYIN_MAP[char];
  if (pinyin) {
    return pinyin[0].toUpperCase();
  }
  // 非中文字符直接返回
  return char.toUpperCase();
}

/**
 * 获取字符串的拼音首字母缩写
 */
export function getPinyinAbbr(str: string): string {
  return str.split('').map(getFirstLetter).join('');
}

/**
 * 检查字符串是否匹配拼音首字母
 */
export function matchesPinyinAbbr(str: string, abbr: string): boolean {
  const strAbbr = getPinyinAbbr(str);
  return strAbbr.toLowerCase().startsWith(abbr.toLowerCase());
}

/**
 * 检查字符串是否包含拼音首字母
 */
export function containsPinyinAbbr(str: string, abbr: string): boolean {
  const strAbbr = getPinyinAbbr(str);
  return strAbbr.toLowerCase().includes(abbr.toLowerCase());
}
