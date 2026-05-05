1.学习资料：https://zhuanlan.zhihu.com/p/135183491 Git 使用教程：最详细、最傻瓜、最浅显、真正手把手教！（万字长文）
  和 ChatGPT

2.实践流程：用谷歌账号创建github账号，并在本地电脑下载并配置git，打开gitbash，创建git 用户名和邮箱（和github使用同一个邮箱）

3.实践流程：用谷歌账号创建github账号，并在本地电脑下载并配置git，打开gitbash，创建git 用户名和邮箱（和github使用同一个邮箱）

4.遇到的问题：

在vscode terminal 中，若直接使用 git clone 来clone github上的项目，会提示端口错误。

解决办法： git config --global https.proxy "127.0.0.1:xxxx" 的xxxx换成自己的电脑端口号即可。
电脑端口号寻找方法：控制面板-网络和Internet-Internet选项-连接-局域网设置-代理服务器-端口