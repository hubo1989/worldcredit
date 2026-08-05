import { createClient } from '@insforge/sdk'

const url = 'https://dr7vjx28.us-east.insforge.app'
const key = 'ik_57fece43b0eb5f4c1110d80f6fa28189'

const insforge = createClient({
  baseUrl: url,
  anonKey: key,
  isServerMode: true
})

async function createAdmin() {
  console.log('正在创建管理员账号...')
  const email = 'admin@worldcredit.com'
  const password = 'WorldCredit2026!'

  const { data, error } = await insforge.auth.signUp({
    email,
    password
  })

  if (error) {
    console.error('创建失败:', error.message)
    process.exit(1)
  }

  console.log('✅ 账号创建成功！')
  console.log(`邮箱: ${email}`)
  console.log(`密码: ${password}`)
  console.log(`User ID: ${data?.user?.id}`)
}

createAdmin()
