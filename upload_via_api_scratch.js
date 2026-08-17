const fs = require('fs');
const path = require('path');

async function run() {
  try {
    console.log('Logging in to deployed server...');
    const loginRes = await fetch('https://trost-gfzd.onrender.com/api/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        email: 'danish@gmail.com',
        password: 'danish123',
        user_type: 'listener'
      })
    });
    
    const loginData = await loginRes.json();
    if (!loginData.status) {
      throw new Error('Login failed: ' + loginData.message);
    }
    
    const token = loginData.access_token;
    console.log('Login successful. Access token obtained.');

    console.log('Reading image file...');
    const imagePath = path.join(__dirname, 'uploads', '1786942662141.jpg');
    const imageBuffer = fs.readFileSync(imagePath);
    
    // Create form data using Node's native FormData
    const formData = new FormData();
    // Wrap the buffer in a Blob
    const blob = new Blob([imageBuffer], { type: 'image/jpeg' });
    formData.append('profile_photo', blob, '1786942662141.jpg');
    
    console.log('Uploading image via API update-profile...');
    const uploadRes = await fetch('https://trost-gfzd.onrender.com/api/update-profile', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${token}`
      },
      body: formData
    });
    
    const uploadData = await uploadRes.json();
    console.log('Upload Response:', JSON.stringify(uploadData, null, 2));

  } catch (err) {
    console.error('Error during upload script:', err);
  }
}

run();
