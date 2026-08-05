// db/seed.ts
import { createClient } from '@insforge/sdk'
import 'dotenv/config'

async function seed() {
  const url = process.env.NEXT_PUBLIC_INSFORGE_URL
  const key = process.env.NEXT_PUBLIC_INSFORGE_ANON_KEY
  
  if (!url || !key) {
    console.error('Missing env vars')
    return
  }

  const client = createClient({ baseUrl: url, anonKey: key })

  console.log('🚀 Starting user creation...')
  
  const email = `test_${Date.now()}@example.com` // 使用唯一样本
  const password = 'password123'

  try {
    // 1. 在 Auth 系统中注册
    const { data: authData, error: authError } = await client.auth.signUp({
      email,
      password,
      name: '测试管理员'
    })

    if (authError) {
      console.error('❌ Auth creation failed:', authError);
      return;
    }

    if (!authData?.user) {
      console.error('❌ No user returned from auth. Server response:', JSON.stringify(authData));
      return;
    }

    const authId = authData.user.id
    console.log(`✅ Auth user created: ${authId} (Email: ${email})`)

    // 2. 同步到业务表
    const { error: dbError } = await client.database
      .from('users')
      .insert({
        auth_id: authId,
        email: email,
        name: '测试管理员',
        role: 'admin'
      })

    if (dbError) {
      console.error('❌ DB sync failed:', dbError.message)
    } else {
      console.log('✅ Business user synced to DB')
      console.log('\n--- Account Details ---')
      console.log(`Email: ${email}`)
      console.log(`Password: ${password}`)
      console.log('-----------------------')
    }
  } catch (err) {
    console.error('🔥 Unexpected error:', err)
  }
}

seed()
