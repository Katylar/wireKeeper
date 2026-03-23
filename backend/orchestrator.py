import asyncio
import uuid
import time
from ws_manager import manager
# from downloader import process_chat_download, sync_chatlist, sync_single_chat, process_batch_download
from tester import process_chat_download, sync_chatlist, sync_single_chat

class Orchestrator:
    def __init__(self):
        self.queue = [] # List of dicts representing pending tasks
        self.current_task = None # Dict of the currently running task
        self._current_async_task = None # The actual asyncio.Task object
        self._wakeup = asyncio.Event()
        self.client = None
        self.conn = None
        # NEW: Instant lookup registry for deduplication
        self.active_signatures = set() 

    def initialize(self, client, conn):
        self.client = client
        self.conn = conn

    def add_task(self, task_type: str, params: dict, broadcast: bool = True):
        chat_id = params.get("chat_id")
        signature = None
        
        # Create a unique signature for this exact job
        if chat_id:
            signature = f"{task_type}_{chat_id}"
            if signature in self.active_signatures:
                return None # Instantly reject duplicates

        task_id = str(uuid.uuid4())
        task = {
            "id": task_id,
            "type": task_type,
            "params": params,
            "status": "pending",
            "signature": signature, # Store it on the task to easily remove later
            "added_at": time.time()
        }
        
        if signature:
            self.active_signatures.add(signature)

        self.queue.append(task)
        self._wakeup.set() 
        
        if broadcast:
            asyncio.create_task(self._broadcast_state())
            
        return task_id

    async def kill_task(self, task_id: str):
        """Removes a task from the queue or cancels it if it's currently running."""
        # 1. Check if it's in the pending queue
        for i, task in enumerate(self.queue):
            if task["id"] == task_id:
                # Remove from signature set so it can be re-queued later
                sig = task.get("signature")
                if sig and sig in self.active_signatures:
                    self.active_signatures.remove(sig)
                
                del self.queue[i]
                await manager.broadcast({"event": "log", "message": f"Task {task['type']} removed from queue."})
                await self._broadcast_state()
                return {"status": "removed_from_queue"}

        # 2. Check if it's the currently running task
        if self.current_task and self.current_task["id"] == task_id:
            if self._current_async_task and not self._current_async_task.done():
                self._current_async_task.cancel() # Triggers asyncio.CancelledError inside the worker
                await manager.broadcast({"event": "log", "message": f"Terminating active task: {self.current_task['type']}..."})
                return {"status": "termination_signal_sent"}
                
        return {"status": "not_found"}

    async def kill_batch(self, batch_id: str):
        """Removes all tasks sharing a batch_id, and cancels the current one if it belongs to the batch."""
        tasks_to_remove = [t for t in self.queue if t.get("params", {}).get("batch_id") == batch_id]
        
        for task in tasks_to_remove:
            # Free up the signature
            sig = task.get("signature")
            if sig and sig in self.active_signatures:
                self.active_signatures.remove(sig)
            self.queue.remove(task)

        # Check if the currently running task is part of this batch
        killed_active = False
        if self.current_task and self.current_task.get("params", {}).get("batch_id") == batch_id:
            if self._current_async_task and not self._current_async_task.done():
                self._current_async_task.cancel()
                killed_active = True
                
        await manager.broadcast({"event": "log", "message": f"Batch {batch_id} terminated. Removed {len(tasks_to_remove)} pending tasks."})
        await self._broadcast_state()
        
        return {"status": "batch_terminated", "removed_count": len(tasks_to_remove), "killed_active": killed_active}

    async def kill_all_singles(self):
        """Removes all standalone tasks (tasks without a batch_id)."""
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
                
        await manager.broadcast({"event": "log", "message": f"Terminated {len(tasks_to_remove)} standalone tasks."})
        await self._broadcast_state()
        
        return {"status": "singles_terminated", "removed_count": len(tasks_to_remove), "killed_active": killed_active}

    async def _broadcast_state(self):
        """Sends the current queue state to the frontend."""
        await manager.broadcast({
            "event": "queue_state",
            "current_task": self.current_task,
            "queue": self.queue
        })

    async def worker_loop(self):
        """The infinite loop that processes tasks one by one."""
        while True:
            if not self.queue:
                self._wakeup.clear()
                await self._wakeup.wait() # Sleep until a new task is added
            
            if not self.client or not self.client.is_connected():
                await asyncio.sleep(5) # Wait for Telegram client to be ready
                continue

            # Pop the first task (FIFO)
            self.current_task = self.queue.pop(0)
            self.current_task["status"] = "running"
            await self._broadcast_state()

            try:
                # Wrap the target function in an asyncio Task so it can be cancelled
                if self.current_task["type"] == "sync-all":
                    self._current_async_task = asyncio.create_task(sync_chatlist(self.client, self.conn))
                elif self.current_task["type"] == "sync-single":
                    self._current_async_task = asyncio.create_task(sync_single_chat(self.client, self.conn, self.current_task["params"]["chat_id"]))
                elif self.current_task["type"] == "download-chat":
                    p = self.current_task["params"]
                    self._current_async_task = asyncio.create_task(process_chat_download(
                        self.client, self.conn, p["chat_id"], p.get("overwrite", False), p.get("validate_mode", False), p.get("resume", True)
                    ))
                # elif self.current_task["type"] == "batch-download":
                #     p = self.current_task["params"]
                #     self._current_async_task = asyncio.create_task(process_batch_download(
                #         self.client, self.conn, p.get("overwrite", False), p.get("validate_mode", False), p.get("resume", True), p.get("sort", "default")
                #     ))
                else:
                    raise ValueError("Unknown task type")

                # Await the execution of the task
                await self._current_async_task
                await manager.broadcast({"event": "log", "message": f"Task completed: {self.current_task['type']}"})

            except asyncio.CancelledError:
                # This is triggered when .cancel() is called on self._current_async_task
                await manager.broadcast({"event": "log", "message": f"Task forcefully aborted: {self.current_task['type']}"})
            except Exception as e:
                await manager.broadcast({"event": "error", "message": f"Task {self.current_task['type']} failed: {e}"})
            finally:
                # Free up the signature so the chat can be queued again later
                if self.current_task:
                    sig = self.current_task.get("signature")
                    if sig and sig in self.active_signatures:
                        self.active_signatures.remove(sig)
                
                self.current_task = None
                self._current_async_task = None
                await self._broadcast_state()

# Global singleton instance
queue_manager = Orchestrator()