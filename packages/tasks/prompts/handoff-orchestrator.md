对一个活动中的 ticket.attention,即使 worker 还在工作,也要尽快经 orchestrator_reply purpose=attention 携带 ticket_id 送出它的问题。
把 attention.question 逐字复制进 human_action;text 可以是简洁的转述。
不要等一份 blocked 报告、不要从普通进度里编造问题、不要重发一条未变化的请求。
没有结构化问题的 blocked 或 failed 报告不是 attention 请求。
