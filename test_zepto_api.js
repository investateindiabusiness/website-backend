require('dotenv').config();

async function testZeptoMailRestAPI() {
  console.log('Testing Zeptomail REST API...');
  try {
    const response = await fetch('https://api.zeptomail.in/v1.1/email', {
      method: 'POST',
      headers: {
        'Accept': 'application/json',
        'Content-Type': 'application/json',
        'Authorization': `Zoho-enczapikey ${process.env.EMAIL_PASS}`
      },
      body: JSON.stringify({
        from: {
          address: "support@investateindia.com",
          name: "Investate India"
        },
        to: [
          {
            email_address: {
              address: "test@example.com",
              name: "Test User"
            }
          }
        ],
        subject: "Test REST API Email",
        htmlbody: "<div><b> Test email from REST API </b></div>"
      })
    });

    const data = await response.json();
    console.log('Response Status:', response.status);
    console.log('Response Body:', data);
  } catch (error) {
    console.error('REST API Error:', error);
  }
}

testZeptoMailRestAPI();
