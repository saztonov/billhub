import { createClient } from '@supabase/supabase-js'
import { getEnvVar } from '@/utils/env'

const supabaseUrl = getEnvVar('VITE_SUPABASE_URL', 'VITE_TEST_SUPABASE_URL')
const supabaseAnonKey = getEnvVar('VITE_SUPABASE_PUBLISHABLE_DEFAULT_KEY', 'VITE_TEST_SUPABASE_PUBLISHABLE_DEFAULT_KEY')

export const supabase = createClient(supabaseUrl, supabaseAnonKey)
