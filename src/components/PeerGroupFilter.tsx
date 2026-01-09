import { useState, useEffect } from "react";
import { Filter, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuCheckboxItem,
  DropdownMenuTrigger,
  DropdownMenuSeparator,
} from "@/components/ui/dropdown-menu";
import { Badge } from "@/components/ui/badge";
import { supabase } from "@/integrations/supabase/client";

interface PeerGroup {
  id: string;
  name: string;
  color: string;
}

interface PeerGroupFilterProps {
  selectedGroups: string[];
  onFilterChange: (groupIds: string[]) => void;
}

export function PeerGroupFilter({ selectedGroups, onFilterChange }: PeerGroupFilterProps) {
  const [groups, setGroups] = useState<PeerGroup[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetchGroups();
  }, []);

  const fetchGroups = async () => {
    try {
      const { data, error } = await supabase
        .from("peer_groups")
        .select("id, name, color")
        .order("name");

      if (error) throw error;
      setGroups(data || []);
    } catch (error) {
      console.error("Error fetching groups:", error);
    } finally {
      setLoading(false);
    }
  };

  const handleToggleGroup = (groupId: string) => {
    if (selectedGroups.includes(groupId)) {
      onFilterChange(selectedGroups.filter((id) => id !== groupId));
    } else {
      onFilterChange([...selectedGroups, groupId]);
    }
  };

  const handleClearFilters = () => {
    onFilterChange([]);
  };

  const handleSelectAll = () => {
    onFilterChange(groups.map((g) => g.id));
  };

  if (loading || groups.length === 0) {
    return null;
  }

  return (
    <div className="flex items-center gap-2">
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="outline" size="sm" className="gap-2">
            <Filter className="h-4 w-4" />
            Filter
            {selectedGroups.length > 0 && (
              <Badge variant="secondary" className="ml-1 h-5 px-1.5">
                {selectedGroups.length}
              </Badge>
            )}
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start" className="w-56">
          <div className="flex items-center justify-between px-2 py-1.5">
            <span className="text-sm font-medium">Filter by Group</span>
            {selectedGroups.length > 0 && (
              <Button
                variant="ghost"
                size="sm"
                className="h-6 px-2 text-xs"
                onClick={handleClearFilters}
              >
                Clear
              </Button>
            )}
          </div>
          <DropdownMenuSeparator />
          <DropdownMenuCheckboxItem
            checked={selectedGroups.length === 0}
            onCheckedChange={handleClearFilters}
          >
            <div className="flex items-center gap-2">
              <div className="h-3 w-3 rounded-full bg-muted-foreground/30" />
              All Peers
            </div>
          </DropdownMenuCheckboxItem>
          <DropdownMenuCheckboxItem
            checked={selectedGroups.includes("ungrouped")}
            onCheckedChange={() => handleToggleGroup("ungrouped")}
          >
            <div className="flex items-center gap-2">
              <div className="h-3 w-3 rounded-full bg-muted-foreground" />
              Ungrouped
            </div>
          </DropdownMenuCheckboxItem>
          <DropdownMenuSeparator />
          {groups.map((group) => (
            <DropdownMenuCheckboxItem
              key={group.id}
              checked={selectedGroups.includes(group.id)}
              onCheckedChange={() => handleToggleGroup(group.id)}
            >
              <div className="flex items-center gap-2">
                <div
                  className="h-3 w-3 rounded-full"
                  style={{ backgroundColor: group.color }}
                />
                {group.name}
              </div>
            </DropdownMenuCheckboxItem>
          ))}
        </DropdownMenuContent>
      </DropdownMenu>

      {/* Show active filters as badges */}
      {selectedGroups.length > 0 && (
        <div className="flex items-center gap-1 flex-wrap">
          {selectedGroups.map((groupId) => {
            if (groupId === "ungrouped") {
              return (
                <Badge
                  key={groupId}
                  variant="secondary"
                  className="gap-1 cursor-pointer hover:bg-secondary/80"
                  onClick={() => handleToggleGroup(groupId)}
                >
                  Ungrouped
                  <X className="h-3 w-3" />
                </Badge>
              );
            }
            const group = groups.find((g) => g.id === groupId);
            if (!group) return null;
            return (
              <Badge
                key={groupId}
                variant="secondary"
                className="gap-1 cursor-pointer hover:bg-secondary/80"
                style={{
                  backgroundColor: `${group.color}20`,
                  color: group.color,
                }}
                onClick={() => handleToggleGroup(groupId)}
              >
                {group.name}
                <X className="h-3 w-3" />
              </Badge>
            );
          })}
        </div>
      )}
    </div>
  );
}