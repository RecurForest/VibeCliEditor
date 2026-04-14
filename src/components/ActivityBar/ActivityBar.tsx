import { Blocks, Files, GitBranch, Play, Search, Settings, UserCircle2 } from "lucide-react";

export function ActivityBar() {
  return (
    <aside className="activity-bar">
      <div className="activity-bar__group">
        <button className="activity-bar__item" data-active="true" type="button">
          <Files size={20} />
        </button>
        <button className="activity-bar__item" type="button">
          <Search size={20} />
        </button>
        <button className="activity-bar__item" type="button">
          <GitBranch size={20} />
        </button>
        <button className="activity-bar__item" type="button">
          <Play size={20} />
        </button>
        <button className="activity-bar__item" type="button">
          <Blocks size={20} />
        </button>
      </div>

      <div className="activity-bar__group">
        <button className="activity-bar__item" type="button">
          <UserCircle2 size={20} />
        </button>
        <button className="activity-bar__item" type="button">
          <Settings size={20} />
        </button>
      </div>
    </aside>
  );
}
