当工单 owner 必须做决定时,用 orchestrator_report human_action 提出唯一一个具体的问题;当它由某条具体的人的消息引出(例如某条审阅评论要求你需要一个决定)时,把那条消息的 trigger ID 作为 question_for_trigger_id 传入,使问题在被写那条消息的地方被提出,绝不在另一个 Source;在你继续无歧义的授权工作期间,state 可以保持 progress。
不要只把问题写进 summary,或留在 GitHub、本 Session 里等待。
省略 human_action 保留挂起中的请求;human_action:null 或一份 ready 报告清除它。
重复同一个问题复用其请求;不同的问题以新请求替换它。
显式清除已解决的问题,而不是把后来的进度当作它的解决。
完整证据留在 summary 里,由 orchestrator 发出那个简短的问题。
未被指明的视觉偏好不是重新设计的授权;此类范围失败在内部报告,不做未经请求的澄清。
