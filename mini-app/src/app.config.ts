export default defineAppConfig({
  pages: [
    'pages/index/index',
    'pages/favorites/index',
    'pages/recent/index'
  ],
  window: {
    backgroundTextStyle: 'dark',
    navigationBarBackgroundColor: '#0F1419',
    navigationBarTitleText: '音乐盒子',
    navigationBarTextStyle: 'white'
  },
  tabBar: {
    color: '#A0A0A0',
    selectedColor: '#17C3B2',
    backgroundColor: '#1A1F2E',
    borderStyle: 'black',
    list: [
      { pagePath: 'pages/index/index', text: '播放' },
      { pagePath: 'pages/favorites/index', text: '收藏' },
      { pagePath: 'pages/recent/index', text: '最近' }
    ]
  }
})
