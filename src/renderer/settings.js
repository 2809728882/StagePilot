const form = document.getElementById('password-form');
const password = document.getElementById('password');
const confirmation = document.getElementById('confirm-password');
const message = document.getElementById('message');

form.addEventListener('submit', async (event) => {
  event.preventDefault();
  message.classList.remove('error');
  if (password.value !== confirmation.value) {
    message.textContent = '两次输入的密码不一致';
    message.classList.add('error');
    return;
  }
  try {
    await window.stagePilotSettings.setPassword(password.value);
    password.value = '';
    confirmation.value = '';
    message.textContent = '密码已保存，旧手机连接已失效';
  } catch (error) {
    message.textContent = error.message || '密码保存失败';
    message.classList.add('error');
  }
});
