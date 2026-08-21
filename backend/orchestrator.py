import asyncio
import uuid
import time
from ws_manager import manager
from downloader import process_chat_download, sync_chatlist, sync_single_chat
from logger import logger # --- NEW ---

class Orchestrator:
    def __init__(self):
        self.queue = [] 
        self.current_task = None 
        self._current_async_task = None 
        self._wakeup = asyncio.Event()
        self.client = None
        self.conn = None
        self.active_signatures = set() 

    def initialize(self, client, conn):
        self.client = client
        self.conn = conn

    def add_task(self, task_type: str, params: dict, broadcast: bool = True):
        chat_id = params.get("chat_id")
        signature = None
        
        if chat_id:
            signature = f"{task_type}_{chat_id}"
            if signature in self.active_signatures:
                logger.debug(f"Task rejected (Duplicate in queue): {signature}")
                return None

        task_id = str(uuid.uuid4())
        task = {
            "id": task_id,
            "type": task_type,
            "params": params,
            "status": "pending",
            "signature": signature, 
            "added_at": time.time()
        }
        
        if signature:
            self.active_signatures.add(signature)

        self.queue.append(task)
        self._wakeup.set() 
        
        logger.debug(f"Added task '{task_type}' to queue (Task ID: {task_id}). Pending depth: {len(self.queue)}")
        
        if broadcast:
            asyncio.create_task(self._broadcast_state())
            
        return task_id

    async def wipe_all(self):
        logger.warning("Executing complete wipe of Orchestrator queue and active tasks!")
        self.queue.clear()
        self.active_signatures.clear()
        
        killed_active = False
        if self._current_async_task and not self._current_async_task.done():
            self._current_async_task.cancel()
            killed_active = True
            
        await manager.broadcast({"event": "log", "message": "Queue purged due to Account Switch."})
        await self._broadcast_state()
        return {"status": "wiped", "killed_active": killed_active}

    async def kill_task(self, task_id: str):
        for i, task in enumerate(self.queue):
            if task["id"] == task_id:
                sig = task.get("signature")
                if sig and sig in self.active_signatures:
                    self.active_signatures.remove(sig)
                
                del self.queue[i]
                logger.info(f"Task {task['type']} successfully removed from pending queue.")
                await manager.broadcast({"event": "log", "message": f"Task {task['type']} removed from queue."})
                await self._broadcast_state()
                return {"status": "removed_from_queue"}

        if self.current_task and self.current_task["id"] == task_id:
            if self._current_async_task and not self._current_async_task.done():
                logger.warning(f"Sending termination signal to active task: {self.current_task['type']}")
                self._current_async_task.cancel() 
                await manager.broadcast({"event": "log", "message": f"Terminating active task: {self.current_task['type']}..."})
                return {"status": "termination_signal_sent"}
                
        logger.debug(f"Kill task failed: Task ID {task_id} not found in active or pending states.")
        return {"status": "not_found"}

    async def kill_batch(self, batch_id: str):
        tasks_to_remove = [t for t in self.queue if t.get("params", {}).get("batch_id") == batch_id]
        
        for task in tasks_to_remove:
            sig = task.get("signature")
            if sig and sig in self.active_signatures:
                self.active_signatures.remove(sig)
            self.queue.remove(task)

        killed_active = False
        if self.current_task and self.current_task.get("params", {}).get("batch_id") == batch_id:
            if self._current_async_task and not self._current_async_task.done():
                self._current_async_task.cancel()
                killed_active = True
                
        logger.info(f"Batch {batch_id} terminated. {len(tasks_to_remove)} tasks dropped. Active task killed: {killed_active}")
        await manager.broadcast({"event": "log", "message": f"Batch {batch_id} terminated. Removed {len(tasks_to_remove)} pending tasks."})
        await self._broadcast_state()
        
        return {"status": "batch_terminated", "removed_count": len(tasks_to_remove), "killed_active": killed_active}

    async def kill_all_singles(self):
        tasks_to_remove = [t for t in self.queue if not t.get("params", {}).get("batch_id")]
        
        for task in tasks_to_remove:
            sig = task.get("signature")
            if sig and sig in self.active_signatures:
                self.active_signatures.remove(sig)
            self.queue.remove(task)

        killed_active = False
        if self.current_task and not self.current_task.get("params", {}).get("batch_id"):
            if self._current_async_task and not self._current_async_task.done():
                self._current_async_task.cancel()
                killed_active = True
                
        logger.info(f"Singles purged. {len(tasks_to_remove)} tasks dropped. Active task killed: {killed_active}")
        await manager.broadcast({"event": "log", "message": f"Terminated {len(tasks_to_remove)} standalone tasks."})
        await self._broadcast_state()
        
        return {"status": "singles_terminated", "removed_count": len(tasks_to_remove), "killed_active": killed_active}

    async def _broadcast_state(self):
        await manager.broadcast({
            "event": "queue_state",
            "current_task": self.current_task,
            "queue": self.queue
        })

    async def worker_loop(self):
        logger.info("Orchestrator worker loop actively listening for tasks.")
        while True:
            if not self.queue:
                self._wakeup.clear()
                await self._wakeup.wait() 
            
            if not self.client or not self.client.is_connected():
                logger.debug("Orchestrator sleeping: Waiting for Telegram client to authenticate/connect.")
                await asyncio.sleep(5) 
                continue

            self.current_task = self.queue.pop(0)
            self.current_task["status"] = "running"
            
            logger.info(f"--- LAUNCHING TASK: {self.current_task['type']} ---")
            logger.debug(f"Task Parameters: {self.current_task['params']}")
            await self._broadcast_state()

            try:
                if self.current_task["type"] == "sync-all":
                    self._current_async_task = asyncio.create_task(sync_chatlist(self.client, self.conn))
                elif self.current_task["type"] == "sync-single":
                    self._current_async_task = asyncio.create_task(sync_single_chat(self.client, self.conn, self.current_task["params"]["chat_id"]))
                elif self.current_task["type"] == "download-chat":
                    p = self.current_task["params"]
                    self._current_async_task = asyncio.create_task(process_chat_download(
                        self.client, self.conn, p["chat_id"], p.get("overwrite", False), p.get("validate_mode", False), p.get("resume", True),
                        p.get("batch_id"), p.get("batch_index"), p.get("batch_total") 
                    ))
                else:
                    logger.error(f"Critical Worker Error: Unknown task type '{self.current_task['type']}'")
                    raise ValueError("Unknown task type")

                await self._current_async_task
                logger.info(f"--- TASK COMPLETED: {self.current_task['type']} ---")
                await manager.broadcast({"event": "log", "message": f"Task completed: {self.current_task['type']}"})

            except asyncio.CancelledError:
                logger.warning(f"--- TASK ABORTED: {self.current_task['type']} (Cancelled by user/system) ---")
                await manager.broadcast({"event": "log", "message": f"Task forcefully aborted: {self.current_task['type']}"})
            except Exception as e:
                logger.error(f"--- TASK FAILED: {self.current_task['type']} threw exception: {e} ---", exc_info=True)
                await manager.broadcast({"event": "error", "message": f"Task {self.current_task['type']} failed: {e}"})
            finally:
                if self.current_task:
                    sig = self.current_task.get("signature")
                    if sig and sig in self.active_signatures:
                        self.active_signatures.remove(sig)
                
                self.current_task = None
                self._current_async_task = None
                await self._broadcast_state()

queue_manager = Orchestrator()