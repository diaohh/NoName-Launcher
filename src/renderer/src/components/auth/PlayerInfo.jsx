import { useAuth } from '../../contexts/AuthContext'

export default function PlayerInfo() {
  const { account } = useAuth()

  if (!account) return null

  return (
    <div className="my-[30px] p-5 bg-white/10 rounded-[10px]">
      <div className="text-2xl font-bold mb-1">{account.displayName}</div>
      <div className="text-xs opacity-70">{account.uuid}</div>
    </div>
  )
}
